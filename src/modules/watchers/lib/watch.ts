import { redactSensitive } from "@/modules/ai/lib/redact";

export const WATCH_ACTIONS = ["notify", "agent", "none"] as const;
export type WatchAction = (typeof WATCH_ACTIONS)[number];

export const MAX_WATCHES = 16;
export const WATCH_OUTPUT_MAX_CHARS = 16 * 1024;
export const WATCH_RUN_TIMEOUT_SECONDS = 60;

export type Watch = {
  id: string;
  name: string;
  command: string;
  cwd: string | null;
  intervalSeconds: number;
  enabled: boolean;
  onChange: WatchAction;
  prompt?: string;
  createdAt: number;
  runCount: number;
  changeCount: number;
  lastRunAt?: number;
  lastChangeAt?: number;
  lastExitCode?: number | null;
  lastError?: string;
  /** Fingerprint of the last successful run, the baseline for the next one. */
  lastDigest?: string;
  /** Redacted, bounded output of the last successful run. */
  lastOutput?: string;
};

export type WatchInput = {
  name: string;
  command: string;
  intervalSeconds: number;
  cwd?: string | null;
  onChange?: WatchAction;
  prompt?: string;
};

export type WatchPatch = Partial<WatchInput>;

export type WatchRunResult =
  | {
      ok: true;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      timedOut: boolean;
    }
  | { ok: false; error: string };

export function newWatchId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createWatch(input: WatchInput, id: string, now: number): Watch {
  const prompt = input.prompt?.trim();
  return {
    id,
    name: input.name.trim(),
    command: input.command.trim(),
    cwd: input.cwd?.trim() || null,
    intervalSeconds: input.intervalSeconds,
    enabled: true,
    onChange: input.onChange ?? "notify",
    ...(prompt ? { prompt } : {}),
    createdAt: now,
    runCount: 0,
    changeCount: 0,
  };
}

/** Apply an edit. A different command or directory makes the old output
 *  meaningless, so the baseline is dropped and the next run starts over. */
export function patchWatch(watch: Watch, patch: WatchPatch): Watch {
  const next: Watch = { ...watch };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.intervalSeconds !== undefined)
    next.intervalSeconds = patch.intervalSeconds;
  if (patch.onChange !== undefined) next.onChange = patch.onChange;
  if (patch.prompt !== undefined) {
    const prompt = patch.prompt.trim();
    if (prompt) next.prompt = prompt;
    else delete next.prompt;
  }
  const command = patch.command?.trim();
  const cwd = patch.cwd === undefined ? undefined : patch.cwd?.trim() || null;
  const retargeted =
    (command !== undefined && command !== watch.command) ||
    (cwd !== undefined && cwd !== watch.cwd);
  if (command !== undefined) next.command = command;
  if (cwd !== undefined) next.cwd = cwd;
  if (retargeted) {
    delete next.lastDigest;
    delete next.lastOutput;
    delete next.lastExitCode;
    delete next.lastError;
  }
  return next;
}

/** When the watch should next run. A watch that never ran is due at once. */
export function nextDueAt(watch: Watch): number {
  if (watch.lastRunAt === undefined) return watch.createdAt;
  return watch.lastRunAt + watch.intervalSeconds * 1000;
}

export function earliestDue(watches: readonly Watch[]): number | null {
  let earliest: number | null = null;
  for (const watch of watches) {
    if (!watch.enabled) continue;
    const due = nextDueAt(watch);
    if (earliest === null || due < earliest) earliest = due;
  }
  return earliest;
}

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function composeOutput(stdout: string, stderr: string): string {
  const out = stdout.replace(/\s+$/, "");
  const err = stderr.replace(/\s+$/, "");
  if (!err) return out;
  return out ? `${out}\n[stderr]\n${err}` : `[stderr]\n${err}`;
}

function bound(text: string): string {
  if (text.length <= WATCH_OUTPUT_MAX_CHARS) return text;
  return `${text.slice(0, WATCH_OUTPUT_MAX_CHARS)}\n[truncated]`;
}

/**
 * Fold one run into the watch. The first successful run only records a
 * baseline; a failed or timed-out run never counts as a change, so a flaky
 * network does not look like news.
 */
export function applyRun(
  watch: Watch,
  result: WatchRunResult,
  now: number,
): { watch: Watch; changed: boolean } {
  const base: Watch = {
    ...watch,
    lastRunAt: now,
    runCount: watch.runCount + 1,
  };
  if (!result.ok || result.timedOut) {
    return {
      watch: {
        ...base,
        lastError: result.ok
          ? `Timed out after ${WATCH_RUN_TIMEOUT_SECONDS} seconds`
          : result.error,
      },
      changed: false,
    };
  }
  const output = composeOutput(result.stdout, result.stderr);
  const digest = fingerprint(`${result.exitCode ?? "signal"}\n${output}`);
  const changed = watch.lastDigest !== undefined && watch.lastDigest !== digest;
  const next: Watch = {
    ...base,
    lastExitCode: result.exitCode,
    lastDigest: digest,
    lastOutput: bound(redactSensitive(output)),
    ...(changed
      ? { lastChangeAt: now, changeCount: watch.changeCount + 1 }
      : {}),
  };
  delete next.lastError;
  return { watch: next, changed };
}

export type WatchSummary = Omit<Watch, "lastDigest" | "lastOutput"> & {
  nextRunAt: number | null;
  running: boolean;
};

export function summarizeWatch(watch: Watch, running: boolean): WatchSummary {
  const { lastDigest: _digest, lastOutput: _output, ...rest } = watch;
  return {
    ...rest,
    nextRunAt: watch.enabled ? nextDueAt(watch) : null,
    running,
  };
}

const WATCH_BLOCK_RE =
  /<terax-watch\s+name="([^"]*)"[^>]*>\n?[\s\S]*?\n?<\/terax-watch>\n*/;

/** The chat message a changed watch hands to the agent. */
export function watchAgentMessage(watch: Watch): string {
  const name = watch.name.replace(/"/g, "'");
  const instruction =
    watch.prompt ??
    "The output of this watch changed. Summarize what changed and update any Terax view that tracks it.";
  return `<terax-watch name="${name}" id="${watch.id}">\n$ ${watch.command}\n${watch.lastOutput ?? ""}\n</terax-watch>\n\n${instruction}`;
}

/** Split a watch message into its label and the instruction that follows. */
export function parseWatchMessage(
  text: string,
): { name: string; rest: string } | null {
  const match = text.match(WATCH_BLOCK_RE);
  if (match?.index !== 0) return null;
  return { name: match[1], rest: text.slice(match[0].length) };
}

export function watchNotification(watch: Watch): { title: string; body: string } {
  const firstLine =
    (watch.lastOutput ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "Output changed";
  return {
    title: `Watch: ${watch.name}`,
    body: firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine,
  };
}
