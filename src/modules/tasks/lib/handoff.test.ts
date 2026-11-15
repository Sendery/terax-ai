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

  it("reports no readiness when the TUI never announces itself", async () => {
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

it("awaits the native baseline and current buffers before confirming a turn", async () => {
  const terminal = fakeTerminal({ readyAtMs: 0 });
  const read = terminal.io.readBuffer;
  terminal.io.readBuffer = async () => await read();
  const result = await handOffPrompt(terminal.io, () => "run the tests");
  expect(result).toEqual({ ready: true, attempts: 1, confirmed: true });
});

it("does not treat missing asynchronous buffers as submission evidence", async () => {
  const terminal = fakeTerminal({ readyAtMs: 0 });
  terminal.io.readBuffer = async () => null;
  const result = await handOffPrompt(terminal.io, () => "run the tests");
  expect(result.confirmed).toBe(false);
});

it("does not confirm a turn from a rejected native query", async () => {
  const terminal = fakeTerminal({ readyAtMs: 0 });
  terminal.io.readBuffer = async () => {
    throw new Error("core closed");
  };
  const result = await handOffPrompt(terminal.io, () => "run the tests");
  expect(result.confirmed).toBe(false);
});

it("resolves native multiline key encoding after actual TUI readiness", async () => {
  const terminal = fakeTerminal({ readyAtMs: 3000 });
  const result = await handOffPrompt(terminal.io, async () => {
    expect(terminal.clockAt()).toBeGreaterThanOrEqual(3000);
    return "one\x1b[13;2utwo";
  });
  expect(result.confirmed).toBe(true);
  expect(terminal.state.typed).toEqual(["one\x1b[13;2utwo"]);
});

it("does not confirm unrelated output that retains an old busy marker", () => {
  expect(
    turnStarted(
      "old\n\u283b Working...\nidle",
      "old\n\u283b Working...\nidle\nbackground log",
    ),
  ).toBe(false);
  expect(turnStarted("\u283b Working...", "\u2839 Working...\nnoise")).toBe(
    false,
  );
});
it("does not confuse the prompt's own busy wording with agent activity", () => {
  expect(turnStarted("idle", "idle\nThinking...", "Thinking...")).toBe(false);
});
it("does not write blind input when readiness times out", async () => {
  const terminal = fakeTerminal({ readyAtMs: Number.POSITIVE_INFINITY });
  const result = await handOffPrompt(terminal.io, () => "prompt");
  expect(terminal.state.lost).toEqual([]);
  expect(result).toEqual({ ready: false, attempts: 0, confirmed: false });
});
it("awaits the prompt write before beginning the Enter settle window", async () => {
  const terminal = fakeTerminal({ readyAtMs: 0 });
  const original = terminal.io.write;
  let finish = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  terminal.io.write = async (data) => {
    if (data !== SUBMIT_KEY) await gate;
    original(data);
  };
  const result = handOffPrompt(terminal.io, () => "prompt");
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(terminal.state.submits).toBe(0);
  finish();
  expect((await result).confirmed).toBe(true);
});
it("does not send stale encoded keystrokes after ownership changes", async () => {
  const terminal = fakeTerminal({ readyAtMs: 0 });
  let current = true;
  Object.assign(terminal.io, { isCurrent: () => current });
  let finish = (_value: string) => {};
  const encoded = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const result = handOffPrompt(terminal.io, () => encoded);
  const rejected = expect(result).rejects.toThrow("available");
  for (let i = 0; i < 5; i++) await Promise.resolve();
  current = false;
  finish("stale prompt");
  await rejected;
  expect(terminal.state.typed).toEqual([]);
  expect(terminal.state.submits).toBe(0);
});
it("does not press Enter after a delayed baseline belongs to a retired target", async () => {
  const terminal = fakeTerminal({ readyAtMs: 0 });
  let current = true;
  Object.assign(terminal.io, { isCurrent: () => current });
  let finish = (_value: string | null) => {};
  terminal.io.readBuffer = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const result = handOffPrompt(terminal.io, () => "prompt");
  const rejected = expect(result).rejects.toThrow("available");
  for (let i = 0; i < 12; i++) await Promise.resolve();
  current = false;
  finish("idle");
  await rejected;
  expect(terminal.state.submits).toBe(0);
});

it("does not attribute an existing busy row's changing detail to a new prompt", () => {
  expect(
    turnStarted("\u283b Reading old-file", "\u2839 Reading other-file"),
  ).toBe(false);
});
it("can recognize an additional busy row while an older one remains in history", () => {
  expect(
    turnStarted("Thinking...\nidle", "Thinking...\nidle\nThinking..."),
  ).toBe(true);
});

it("does not confirm an old spinner's changing timer", () => {
  expect(turnStarted("\u280b Thinking (1s)", "\u2819 Thinking (2s)")).toBe(
    false,
  );
});
it("ignores busy wording in prefixed and soft-wrapped prompt echoes", () => {
  expect(
    turnStarted(
      "idle",
      "> Explain esc to interrupt",
      "Explain esc to interrupt",
    ),
  ).toBe(false);
  expect(
    turnStarted(
      "idle",
      "> Explain\nesc to interrupt",
      "Explain esc to interrupt",
    ),
  ).toBe(false);
});
