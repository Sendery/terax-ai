import { create } from "zustand";
import { osNotify } from "@/modules/agents/lib/notify";
import { native } from "@/modules/ai/lib/native";
import { loadWatches, saveWatches } from "./persistence";
import {
  applyRun,
  createWatch,
  earliestDue,
  MAX_WATCHES,
  newWatchId,
  nextDueAt,
  patchWatch,
  summarizeWatch,
  WATCH_RUN_TIMEOUT_SECONDS,
  type Watch,
  type WatchInput,
  type WatchPatch,
  type WatchRunResult,
  type WatchSummary,
  watchAgentMessage,
  watchNotification,
} from "./watch";

/** How a changed watch reaches the Terax AI chat. Resolves false while the
 *  agent is busy or unavailable, so the delivery is retried. */
export type AgentDelivery = (message: string) => Promise<boolean>;

type State = {
  hydrated: boolean;
  watches: Watch[];
  running: string[];
};

const DELIVERY_RETRY_MS = 5000;
const MAX_DELIVERY_ATTEMPTS = 60;
const RUN_REPLY_MS = 10_000;
const MIN_TICK_MS = 250;
const MAX_TICK_MS = 2 ** 31 - 1;

export const useWatchStore = create<State>(() => ({
  hydrated: false,
  watches: [],
  running: [],
}));

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let deliver: AgentDelivery | null = null;
let fallbackCwd: () => string | null = () => null;
const pendingDeliveries = new Map<
  string,
  { message: string; name: string; attempts: number }
>();

function failure(message: string): never {
  throw { code: "command_failed", message };
}

function commit(watches: Watch[]): void {
  useWatchStore.setState({ watches });
  void saveWatches(watches);
}

function find(id: string): Watch {
  const watch = useWatchStore.getState().watches.find((w) => w.id === id);
  if (!watch) failure(`Watch ${id} not found`);
  return watch;
}

function replace(next: Watch): void {
  commit(
    useWatchStore.getState().watches.map((w) => (w.id === next.id ? next : w)),
  );
}

function isRunning(id: string): boolean {
  return useWatchStore.getState().running.includes(id);
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!started) return;
  const due = earliestDue(useWatchStore.getState().watches);
  const retry = pendingDeliveries.size > 0 ? Date.now() + DELIVERY_RETRY_MS : null;
  const next = due === null ? retry : retry === null ? due : Math.min(due, retry);
  if (next === null) return;
  const delay = Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, next - Date.now()));
  timer = setTimeout(tick, delay);
}

/** One hand-off per pass: the next waits until the agent is idle again. A
 *  delivery that keeps failing ends as a notification, never as a silent drop. */
async function flushDeliveries(): Promise<void> {
  if (!deliver) return;
  const first = pendingDeliveries.entries().next().value;
  if (!first) return;
  const [id, pending] = first;
  if (await deliver(pending.message)) {
    pendingDeliveries.delete(id);
    return;
  }
  pending.attempts += 1;
  if (pending.attempts < MAX_DELIVERY_ATTEMPTS) return;
  pendingDeliveries.delete(id);
  await osNotify(
    `Watch: ${pending.name}`,
    "Output changed, but the agent could not be reached.",
  );
}

function tick(): void {
  timer = null;
  const now = Date.now();
  for (const watch of useWatchStore.getState().watches) {
    if (watch.enabled && nextDueAt(watch) <= now && !isRunning(watch.id)) {
      void execute(watch.id);
    }
  }
  void flushDeliveries().finally(schedule);
}

async function runCommand(watch: Watch): Promise<WatchRunResult> {
  try {
    const out = await native.runCommand(
      watch.command,
      watch.cwd ?? fallbackCwd(),
      WATCH_RUN_TIMEOUT_SECONDS,
    );
    return {
      ok: true,
      stdout: out.stdout,
      stderr: out.stderr,
      exitCode: out.exit_code,
      timedOut: out.timed_out,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function react(watch: Watch): Promise<void> {
  if (watch.onChange === "none") return;
  if (watch.onChange === "agent" && deliver) {
    // Only the newest output matters: a later change replaces an undelivered one.
    pendingDeliveries.set(watch.id, {
      message: watchAgentMessage(watch),
      name: watch.name,
      attempts: 0,
    });
    await flushDeliveries();
    return;
  }
  const { title, body } = watchNotification(watch);
  await osNotify(title, body);
}

async function execute(id: string): Promise<{ watch: Watch; changed: boolean }> {
  const before = find(id);
  useWatchStore.setState((s) => ({ running: [...s.running, id] }));
  try {
    const result = await runCommand(before);
    // The watch may have been edited or removed while the command ran.
    const current = useWatchStore.getState().watches.find((w) => w.id === id);
    if (!current) return { watch: before, changed: false };
    const retargeted =
      current.command !== before.command || current.cwd !== before.cwd;
    if (retargeted) return { watch: current, changed: false };
    const applied = applyRun(current, result, Date.now());
    replace(applied.watch);
    if (applied.changed) await react(applied.watch);
    return applied;
  } finally {
    useWatchStore.setState((s) => ({
      running: s.running.filter((value) => value !== id),
    }));
    schedule();
  }
}

/** Load persisted watches and start polling. Idle when none are enabled. */
export async function startWatchRunner(options: {
  deliverToAgent: AgentDelivery;
  getFallbackCwd: () => string | null;
}): Promise<void> {
  deliver = options.deliverToAgent;
  fallbackCwd = options.getFallbackCwd;
  if (started) return;
  started = true;
  if (!useWatchStore.getState().hydrated) {
    const watches = await loadWatches();
    useWatchStore.setState({ watches, hydrated: true });
  }
  schedule();
}

export function stopWatchRunner(): void {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

function summary(watch: Watch): WatchSummary {
  return summarizeWatch(watch, isRunning(watch.id));
}

export const watchCommands = {
  list: (): { watches: WatchSummary[] } => ({
    watches: useWatchStore.getState().watches.map(summary),
  }),
  read: (id: string) => {
    const watch = find(id);
    return { ...summary(watch), output: watch.lastOutput ?? null };
  },
  add: (input: WatchInput): WatchSummary => {
    const watches = useWatchStore.getState().watches;
    if (watches.length >= MAX_WATCHES)
      failure(`At most ${MAX_WATCHES} watches can exist; remove one first`);
    const watch = createWatch(input, newWatchId(), Date.now());
    commit([...watches, watch]);
    schedule();
    return summary(watch);
  },
  update: (id: string, patch: WatchPatch): WatchSummary => {
    const next = patchWatch(find(id), patch);
    replace(next);
    schedule();
    return summary(next);
  },
  remove: (id: string): { removed: string } => {
    find(id);
    pendingDeliveries.delete(id);
    commit(useWatchStore.getState().watches.filter((w) => w.id !== id));
    schedule();
    return { removed: id };
  },
  setEnabled: (id: string, enabled: boolean): WatchSummary => {
    const next = { ...find(id), enabled };
    replace(next);
    schedule();
    return summary(next);
  },
  /** Callers behind the bridge time out after 15 seconds, so a slow command
   *  is reported as still running instead of holding the reply. */
  run: async (id: string) => {
    if (isRunning(id)) failure(`Watch ${id} is already running`);
    const run = execute(id);
    const settled = await Promise.race([
      run,
      new Promise<null>((resolve) => setTimeout(resolve, RUN_REPLY_MS, null)),
    ]);
    if (!settled) {
      run.catch(() => {});
      return { ...summary(find(id)), changed: null, output: null };
    }
    return {
      ...summary(settled.watch),
      changed: settled.changed,
      output: settled.watch.lastOutput ?? null,
    };
  },
};
