/**
 * Handing a prompt to an interactive agent session is the fragile half of a
 * terminal run. Keystrokes only land once the agent's TUI has taken the
 * terminal into raw mode: type a moment too early and the text is still
 * buffered by the line discipline, the submitting Enter is folded into that
 * same burst, and the prompt sits in the composer unsent — the run looks fine
 * while nothing was ever asked.
 *
 * So this module never guesses with a fixed delay. It waits for the TUI to
 * announce itself, types, presses Enter, and then checks the terminal for
 * evidence that the turn actually started, pressing Enter again if it did not.
 * A redundant Enter is harmless: it lands on an empty composer.
 */

import { SUBMIT_KEY } from "./dispatch";

export const HANDOFF_TIMING = {
  /** How often the TUI readiness signal is sampled. */
  readyPollMs: 150,
  /** Beyond this the agent is assumed broken and we type as a last resort. */
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
  write: (data: string) => void;
  /** True once a full-screen TUI has the terminal in raw mode. */
  isReady: () => boolean;
  /** Visible terminal text, or null when this leaf has no live buffer. */
  readBuffer: () => string | null;
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

// Braille spinner frames every TUI agent animates while it is busy.
const SPINNER = /[\u2800-\u28ff]/;
const BUSY_WORDS = /working|thinking|esc to interrupt/i;

/**
 * Whether the terminal shows an agent that has taken a turn. The baseline is
 * the screen captured just before Enter: an idle agent repaints nothing, so a
 * change plus a busy marker is the pair that distinguishes a submitted prompt
 * from one that only grew a line in the composer.
 */
export function turnStarted(baseline: string | null, current: string | null): boolean {
  if (baseline === null || current === null) return false;
  if (current === baseline) return false;
  return SPINNER.test(current) || BUSY_WORDS.test(current);
}

async function waitForReady(io: HandoffIo): Promise<boolean> {
  const deadline = io.now() + HANDOFF_TIMING.readyTimeoutMs;
  while (io.now() < deadline) {
    if (io.isReady()) return true;
    await io.sleep(HANDOFF_TIMING.readyPollMs);
  }
  return io.isReady();
}

async function pressEnterAndWatch(io: HandoffIo): Promise<boolean> {
  const baseline = io.readBuffer();
  io.write(SUBMIT_KEY);
  const deadline = io.now() + HANDOFF_TIMING.verifyWindowMs;
  while (io.now() < deadline) {
    await io.sleep(HANDOFF_TIMING.verifyPollMs);
    if (turnStarted(baseline, io.readBuffer())) return true;
  }
  return false;
}

/**
 * Types a prompt into a live agent session and submits it.
 *
 * `keystrokes` is a callback rather than a string because the encoding of a
 * line break depends on the keyboard protocol the agent negotiates while it
 * boots: it can only be resolved once the TUI is up.
 */
export async function handOffPrompt(
  io: HandoffIo,
  keystrokes: () => string,
): Promise<HandoffResult> {
  const ready = await waitForReady(io);
  if (ready) await io.sleep(HANDOFF_TIMING.readySettleMs);

  const keys = keystrokes();
  if (keys !== "") io.write(keys);
  await io.sleep(HANDOFF_TIMING.typeSettleMs);

  for (let attempt = 1; attempt <= HANDOFF_TIMING.maxSubmits; attempt++) {
    if (await pressEnterAndWatch(io)) {
      return { ready, attempts: attempt, confirmed: true };
    }
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
    return `Prompt typed into ${session} in tab ${where.tabId}, but the agent never signalled it was ready.`;
  }
  if (!result.confirmed) {
    return `Prompt sent to ${session} in tab ${where.tabId}; the session did not visibly start a turn.`;
  }
  return `Prompt sent to ${session} in tab ${where.tabId}.`;
}
