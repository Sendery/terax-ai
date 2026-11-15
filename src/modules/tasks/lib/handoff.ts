/** Delivers a prompt once to a captured TUI and verifies new turn activity. */

import { SUBMIT_KEY } from "./dispatch";

export const HANDOFF_TIMING = {
  /** How often the TUI readiness signal is sampled. */
  readyPollMs: 150,
  /** A TUI that never becomes ready receives no prompt. */
  readyTimeoutMs: 45_000,
  /** Breathing room between the TUI appearing and the first keystroke. */
  readySettleMs: 300,
  /** Gap between the prompt and its Enter, so the TUI sees two reads. */
  typeSettleMs: 200,
  /** How often the terminal is checked for a started turn. */
  verifyPollMs: 250,
  /** How long one Enter is given to produce that evidence. */
  verifyWindowMs: 1_500,
  /** Enter presses before giving up on confirming the turn. */
  maxSubmits: 3,
} as const;

export type HandoffIo = {
  /** Writes raw bytes to the terminal the agent is reading. */
  write: (data: string) => void | Promise<void>;
  isCurrent?: () => boolean;
  prompt?: string;
  /** True once a full-screen TUI has the terminal in raw mode. */
  isReady: () => boolean;
  /** Visible terminal text, or null when this leaf has no live buffer. */
  readBuffer: () => string | null | Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export type HandoffResult = {
  /** The TUI announced itself before we typed. */
  ready: boolean;
  /** Enter presses spent. */
  attempts: number;
  /** The terminal showed the agent working after Enter. */
  confirmed: boolean;
};

const SPINNER = /[\u2801-\u28ff]/;
const SPINNERS = /[\u2800-\u28ff]/g;
const BUSY_WORDS = /^(?:working|thinking)(?:\b|\u2026)|\besc to interrupt\b/i;
function marker(line: string): string {
  return line
    .trim()
    .replace(SPINNERS, "<spinner>")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
export function turnStarted(
  baseline: string | null,
  current: string | null,
  prompt = "",
): boolean {
  if (baseline === null || current === null || current === baseline)
    return false;

  const promptText = marker(prompt).replace(/\s+/g, "");
  const count = (text: string) =>
    text.split(/\r?\n/).filter((line) => {
      const key = marker(line)
        .replace(/^(?:[>\u203a\u276f|\u2502]\s*)+/, "")
        .replace(/\s+/g, "");
      if (key !== "" && promptText.includes(key)) return false;
      return SPINNER.test(line) || BUSY_WORDS.test(line.trim());
    }).length;
  return count(current) > count(baseline);
}
function assertCurrent(io: HandoffIo): void {
  if (io.isCurrent && !io.isCurrent())
    throw new Error("Task terminal is no longer available.");
}
function assertReady(io: HandoffIo): void {
  assertCurrent(io);
  if (!io.isReady()) throw new Error("Agent terminal is no longer ready.");
}
async function waitForReady(io: HandoffIo): Promise<boolean> {
  const deadline = io.now() + HANDOFF_TIMING.readyTimeoutMs;
  while (io.now() < deadline) {
    assertCurrent(io);
    if (io.isReady()) return true;
    await io.sleep(HANDOFF_TIMING.readyPollMs);
  }
  assertCurrent(io);
  return io.isReady();
}
async function readBuffer(io: HandoffIo): Promise<string | null> {
  assertCurrent(io);
  let value: string | null = null;
  try {
    value = await io.readBuffer();
  } catch {}
  assertCurrent(io);
  return value;
}
async function write(io: HandoffIo, data: string): Promise<void> {
  assertReady(io);
  await io.write(data);
  assertCurrent(io);
}
async function pressEnterAndWatch(
  io: HandoffIo,
  prompt: string,
  baseline: string | null,
): Promise<boolean> {
  await write(io, SUBMIT_KEY);
  const deadline = io.now() + HANDOFF_TIMING.verifyWindowMs;
  while (io.now() < deadline) {
    await io.sleep(HANDOFF_TIMING.verifyPollMs);
    assertCurrent(io);
    if (turnStarted(baseline, await readBuffer(io), prompt)) return true;
  }
  return false;
}
export async function handOffPrompt(
  io: HandoffIo,
  keystrokes: () => string | Promise<string>,
): Promise<HandoffResult> {
  const ready = await waitForReady(io);
  if (!ready) return { ready: false, attempts: 0, confirmed: false };
  await io.sleep(HANDOFF_TIMING.readySettleMs);
  assertReady(io);
  const keys = await keystrokes();
  assertReady(io);
  if (keys !== "") await write(io, keys);
  await io.sleep(HANDOFF_TIMING.typeSettleMs);
  assertReady(io);
  const baseline = await readBuffer(io);
  for (let attempt = 1; attempt <= HANDOFF_TIMING.maxSubmits; attempt++) {
    if (
      attempt > 1 &&
      turnStarted(baseline, await readBuffer(io), io.prompt ?? keys)
    )
      return { ready, attempts: attempt - 1, confirmed: true };
    if (await pressEnterAndWatch(io, io.prompt ?? keys, baseline))
      return { ready, attempts: attempt, confirmed: true };
  }
  return { ready, attempts: HANDOFF_TIMING.maxSubmits, confirmed: false };
}

/** One line for the run card describing how the hand-off went. */
export function handoffMessage(
  result: HandoffResult,
  where: { tabId: number; reused: boolean },
): string {
  const session = where.reused ? "the running session" : "a new session";
  if (!result.ready) {
    return `No prompt sent to ${session} in tab ${where.tabId}, but the agent never signalled it was ready.`;
  }
  if (!result.confirmed) {
    return `Prompt sent to ${session} in tab ${where.tabId}; the session did not visibly start a turn.`;
  }
  return `Prompt sent to ${session} in tab ${where.tabId}.`;
}
