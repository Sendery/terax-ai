import { describe, expect, it } from "vitest";

import {
  buildPiArgv,
  formatCommandLine,
  promptKeystrokes,
  recoverCommandLine,
  sessionIdFor,
  SUBMIT_KEY,
  summariseOutput,
} from "./dispatch";
import { createTask, type ScheduledTask } from "./task";

const NOW = new Date(2026, 7, 3, 9, 30).getTime();

function make(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    ...createTask(
      {
        name: "Watch CI",
        prompt: "check ci",
        cwd: "/Users/dev/project",
        schedule: { kind: "everyN", minutes: 60 },
      },
      NOW,
    ),
    id: "st-abc",
    ...overrides,
  };
}

describe("sessionIdFor", () => {
  it("reuses the configured session so a task accumulates context", () => {
    const task = make({
      mode: "task",
      sessions: [{ id: "019fc4f0", cwd: "/Users/dev/project" }],
    });
    expect(sessionIdFor(task, NOW)).toBe("019fc4f0");
    expect(sessionIdFor(task, NOW + 3_600_000)).toBe("019fc4f0");
  });

  it("owns a stable session id when none was configured", () => {
    const task = make({ mode: "task" });
    expect(sessionIdFor(task, NOW)).toBe("terax-st-abc");
    expect(sessionIdFor(task, NOW + 3_600_000)).toBe("terax-st-abc");
  });

  it("mints a fresh timestamped session for every routine run", () => {
    const task = make({ mode: "routine" });
    const first = sessionIdFor(task, NOW);
    const second = sessionIdFor(task, NOW + 1_000);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^terax-st-abc-\d{8}T\d{6}$/);
  });

  it("ignores a configured session in routine mode, since context must be fresh", () => {
    const task = make({
      mode: "routine",
      sessions: [{ id: "019fc4f0", cwd: "/Users/dev/project" }],
    });
    expect(sessionIdFor(task, NOW)).not.toBe("019fc4f0");
  });
});

describe("buildPiArgv", () => {
  it("builds an interactive launch that reuses the session", () => {
    expect(buildPiArgv(make(), "sess-1", { headless: false })).toEqual([
      "pi",
      "--session-id",
      "sess-1",
    ]);
  });

  it("builds a headless run carrying the prompt", () => {
    expect(
      buildPiArgv(make({ prompt: "check ci" }), "sess-1", { headless: true }),
    ).toEqual(["pi", "--print", "--session-id", "sess-1", "check ci"]);
  });

  it("passes the configured model, provider and thinking level", () => {
    const task = make({
      model: "claude-opus-5",
      provider: "anthropic",
      thinking: "high",
    });
    expect(buildPiArgv(task, "sess-1", { headless: true })).toEqual([
      "pi",
      "--print",
      "--provider",
      "anthropic",
      "--model",
      "claude-opus-5",
      "--thinking",
      "high",
      "--session-id",
      "sess-1",
      "check ci",
    ]);
  });

  it("omits inherited options entirely rather than passing empty flags", () => {
    const argv = buildPiArgv(make(), "sess-1", { headless: true });
    expect(argv).not.toContain("--model");
    expect(argv).not.toContain("--provider");
    expect(argv).not.toContain("--thinking");
  });

  it("never puts the prompt on an interactive launch, so it can be typed instead", () => {
    const argv = buildPiArgv(make({ prompt: "line one\nline two" }), "s", {
      headless: false,
    });
    expect(argv).not.toContain("line one\nline two");
  });
});

describe("formatCommandLine", () => {
  it("quotes for a POSIX shell", () => {
    expect(
      formatCommandLine(["pi", "--session-id", "sess 1"], "posix"),
    ).toBe("pi --session-id 'sess 1'");
  });

  it("escapes an embedded single quote for a POSIX shell", () => {
    expect(formatCommandLine(["echo", "it's"], "posix")).toBe(
      "echo 'it'\\''s'",
    );
  });

  it("leaves safe arguments unquoted", () => {
    expect(formatCommandLine(["pi", "--print", "/tmp/x-1_2.txt"], "posix")).toBe(
      "pi --print /tmp/x-1_2.txt",
    );
  });

  it("quotes for PowerShell", () => {
    expect(formatCommandLine(["pi", "sess 1"], "windows")).toBe(
      "pi 'sess 1'",
    );
    expect(formatCommandLine(["echo", "it's"], "windows")).toBe(
      "echo 'it''s'",
    );
  });
});

describe("promptKeystrokes", () => {
  const SHIFT_ENTER = "\u001b[27;2;13~";

  it("types a single line without submitting it", () => {
    expect(promptKeystrokes("check ci", SHIFT_ENTER)).toBe("check ci");
  });

  it("never ends in a carriage return, which a TUI would treat as a paste", () => {
    for (const prompt of ["one", "one\ntwo", "a\n\nb"]) {
      expect(promptKeystrokes(prompt, SHIFT_ENTER).endsWith(SUBMIT_KEY)).toBe(
        false,
      );
    }
    expect(SUBMIT_KEY).toBe("\r");
  });

  it("uses the negotiated shift enter sequence between lines, never a raw newline", () => {
    const keys = promptKeystrokes("line one\nline two", SHIFT_ENTER);
    expect(keys).toBe(`line one${SHIFT_ENTER}line two`);
    expect(keys).not.toContain("\n");
  });

  it("normalises windows line endings", () => {
    expect(promptKeystrokes("a\r\nb", SHIFT_ENTER)).toBe(`a${SHIFT_ENTER}b`);
  });

  it("keeps blank lines inside the prompt", () => {
    expect(promptKeystrokes("a\n\nb", SHIFT_ENTER)).toBe(
      `a${SHIFT_ENTER}${SHIFT_ENTER}b`,
    );
  });

  it("falls back to the legacy sequence when modifyOtherKeys is inactive", () => {
    expect(promptKeystrokes("a\nb", "\u001b\r")).toBe("a\u001b\rb");
  });

  it("types nothing for an empty prompt", () => {
    expect(promptKeystrokes("", SHIFT_ENTER)).toBe("");
    expect(promptKeystrokes("   ", SHIFT_ENTER)).toBe("");
  });
});

describe("summariseOutput", () => {
  it("reports the last meaningful line on success", () => {
    expect(summariseOutput("working\n\nall green\n", 0)).toBe("all green");
  });

  it("says so when a successful run printed nothing", () => {
    expect(summariseOutput("\n  \n", 0)).toBe("Completed with no output.");
  });

  it("surfaces the error line and the exit code on failure", () => {
    expect(
      summariseOutput("starting\nError: missing API key\nbye", 1),
    ).toBe("exit 1: Error: missing API key");
  });

  it("falls back to the last line when nothing looks like an error", () => {
    expect(summariseOutput("a\nb", 3)).toBe("exit 3: b");
  });

  it("marks a signal terminated run", () => {
    expect(summariseOutput("killed", null)).toBe("terminated: killed");
  });

  it("strips terminal control sequences so the card stays readable", () => {
    expect(summariseOutput("\u001b[32mall green\u001b[0m", 0)).toBe("all green");
  });

  it("caps a runaway line", () => {
    const summary = summariseOutput("x".repeat(1_000), 0);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith("\u2026")).toBe(true);
  });
});

describe("recoverCommandLine", () => {
  it("lands in the run directory and reopens the session for review", () => {
    expect(
      recoverCommandLine(
        { cwd: "/Users/dev/project", sessionId: "019fc4f0" },
        "posix",
      ),
    ).toBe("cd /Users/dev/project && pi --session 019fc4f0");
  });

  it("quotes a directory containing spaces", () => {
    expect(
      recoverCommandLine(
        { cwd: "/Users/dev/my project", sessionId: "s" },
        "posix",
      ),
    ).toBe("cd '/Users/dev/my project' && pi --session s");
  });

  it("chains with a semicolon on PowerShell", () => {
    expect(
      recoverCommandLine({ cwd: "C:/dev/project", sessionId: "s" }, "windows"),
    ).toBe("cd C:/dev/project; pi --session s");
  });
});
