import { describe, expect, it } from "vitest";

import { SUBMIT_KEY } from "./dispatch";
import {
  HANDOFF_TIMING,
  type HandoffIo,
  handoffMessage,
  handOffPrompt,
  turnStarted,
} from "./handoff";

/**
 * A terminal that only accepts keystrokes once its TUI is up, mirroring the
 * failure this module exists for: everything typed before that is lost.
 */
function fakeTerminal(options: {
  readyAtMs: number;
  /** Enter presses that are silently dropped even after the TUI is ready. */
  swallowSubmits?: number;
  screenWhenIdle?: string;
  screenWhenWorking?: string;
}) {
  const idle = options.screenWhenIdle ?? "pi\n> ";
  const working = options.screenWhenWorking ?? "pi\n\u283b Working...";
  let clock = 0;
  let swallow = options.swallowSubmits ?? 0;
  const state = {
    typed: [] as string[],
    lost: [] as string[],
    submits: 0,
    composer: "",
    turnStarted: false,
  };
  const io: HandoffIo = {
    write: (data) => {
      if (clock < options.readyAtMs) {
        state.lost.push(data);
        return;
      }
      if (data === SUBMIT_KEY) {
        state.submits++;
        if (swallow > 0) {
          swallow--;
          return;
        }
        if (state.composer !== "") {
          state.composer = "";
          state.turnStarted = true;
        }
        return;
      }
      state.typed.push(data);
      state.composer += data;
    },
    isReady: () => clock >= options.readyAtMs,
    readBuffer: () => (state.turnStarted ? working : idle),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { io, state, clockAt: () => clock };
}

describe("turnStarted", () => {
  it("needs both a changed screen and a busy marker", () => {
    expect(turnStarted("idle", "\u283b Working...")).toBe(true);
    expect(turnStarted("\u283b Working...", "\u283b Working...")).toBe(false);
    expect(turnStarted("idle", "idle\nmy prompt")).toBe(false);
  });

  it("reads a leaf with no live buffer as no evidence", () => {
    expect(turnStarted(null, "\u283b Working...")).toBe(false);
    expect(turnStarted("idle", null)).toBe(false);
  });

  it("recognises the wording other agents use while busy", () => {
    expect(turnStarted("idle", "esc to interrupt")).toBe(true);
    expect(turnStarted("idle", "Thinking\u2026")).toBe(true);
  });
});

describe("handOffPrompt", () => {
  it("waits for the TUI instead of typing into a booting agent", async () => {
    const t = fakeTerminal({ readyAtMs: 5_000 });
    const result = await handOffPrompt(t.io, () => "run the tests");

    expect(t.state.lost).toEqual([]);
    expect(t.state.typed).toEqual(["run the tests"]);
    expect(result).toEqual({ ready: true, attempts: 1, confirmed: true });
  });

  it("submits with a separate Enter after the prompt", async () => {
    const t = fakeTerminal({ readyAtMs: 0 });
    await handOffPrompt(t.io, () => "run the tests");

    expect(t.state.submits).toBe(1);
    expect(t.state.typed.some((d) => d.includes(SUBMIT_KEY))).toBe(false);
    expect(t.state.turnStarted).toBe(true);
  });

  it("presses Enter again when the turn did not start", async () => {
    const t = fakeTerminal({ readyAtMs: 0, swallowSubmits: 2 });
    const result = await handOffPrompt(t.io, () => "run the tests");

    expect(t.state.submits).toBe(3);
    expect(result.confirmed).toBe(true);
    expect(t.state.turnStarted).toBe(true);
  });

  it("gives up after a bounded number of Enter presses", async () => {
    const t = fakeTerminal({ readyAtMs: 0, swallowSubmits: 99 });
    const result = await handOffPrompt(t.io, () => "run the tests");

    expect(t.state.submits).toBe(HANDOFF_TIMING.maxSubmits);
    expect(result).toEqual({
      ready: true,
      attempts: HANDOFF_TIMING.maxSubmits,
      confirmed: false,
    });
  });

  it("still types as a last resort when the TUI never announces itself", async () => {
    const t = fakeTerminal({ readyAtMs: Number.POSITIVE_INFINITY });
    const result = await handOffPrompt(t.io, () => "run the tests");

    expect(result.ready).toBe(false);
    expect(t.clockAt()).toBeGreaterThanOrEqual(HANDOFF_TIMING.readyTimeoutMs);
  });

  it("resolves the keystrokes only after the TUI negotiated its protocol", async () => {
    const t = fakeTerminal({ readyAtMs: 3_000 });
    const seenAt: number[] = [];
    await handOffPrompt(t.io, () => {
      seenAt.push(t.clockAt());
      return "line one\u001b[27;2;13~line two";
    });

    expect(seenAt).toHaveLength(1);
    expect(seenAt[0]).toBeGreaterThanOrEqual(3_000);
  });

  it("sends nothing but an Enter for an empty keystroke string", async () => {
    const t = fakeTerminal({ readyAtMs: 0 });
    await handOffPrompt(t.io, () => "");

    expect(t.state.typed).toEqual([]);
    expect(t.state.submits).toBeGreaterThan(0);
  });
});

describe("handoffMessage", () => {
  it("names the tab and whether the session was reused", () => {
    expect(
      handoffMessage(
        { ready: true, attempts: 1, confirmed: true },
        { tabId: 3, reused: true },
      ),
    ).toBe("Prompt sent to the running session in tab 3.");
    expect(
      handoffMessage(
        { ready: true, attempts: 1, confirmed: true },
        { tabId: 3, reused: false },
      ),
    ).toBe("Prompt sent to a new session in tab 3.");
  });

  it("says when the agent never appeared or never started a turn", () => {
    expect(
      handoffMessage(
        { ready: false, attempts: 3, confirmed: false },
        { tabId: 7, reused: false },
      ),
    ).toContain("never signalled it was ready");
    expect(
      handoffMessage(
        { ready: true, attempts: 3, confirmed: false },
        { tabId: 7, reused: false },
      ),
    ).toContain("did not visibly start a turn");
  });
});
