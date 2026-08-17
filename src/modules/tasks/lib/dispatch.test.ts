import { describe, expect, it } from "vitest";

import {
  buildAgentArgv,
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
    seed: undefined,
    ...overrides,
  };
}

const SEED = "739c3224-00f8-4504-99a4-06708d16dfeb";

describe("sessionIdFor", () => {
  it("reuses the configured session so a task accumulates context", () => {
    const task = make({
      mode: "task",
      sessions: [{ id: "019fc4f0", cwd: "/Users/dev/project" }],
    });
    expect(sessionIdFor(task, NOW)).toBe("019fc4f0");
    expect(sessionIdFor(task, NOW + 3_600_000)).toBe("019fc4f0");
  });

  it("owns a stable legacy session id when there is no seed", () => {
    const task = make({ mode: "task" });
    expect(sessionIdFor(task, NOW)).toBe("terax-st-abc");
    expect(sessionIdFor(task, NOW + 3_600_000)).toBe("terax-st-abc");
  });

  it("names the session after the seed, so regenerating it starts a new one", () => {
    const task = make({ mode: "task", seed: SEED });
    expect(sessionIdFor(task, NOW)).toBe(SEED);
    expect(sessionIdFor({ ...task, seed: "other-seed" }, NOW)).toBe("other-seed");
  });

  it("prefers an explicitly configured session over the seed", () => {
    const task = make({
      mode: "task",
      seed: SEED,
      sessions: [{ id: "019fc4f0", cwd: "/Users/dev/project" }],
    });
    expect(sessionIdFor(task, NOW)).toBe("019fc4f0");
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

describe("buildAgentArgv for pi", () => {
  it("builds an interactive launch that reuses the session", () => {
    expect(buildAgentArgv(make(), "sess-1", { headless: false })).toEqual([
      "pi",
      "--session-id",
      "sess-1",
    ]);
  });

  it("builds a headless run carrying the prompt", () => {
    expect(
      buildAgentArgv(make({ prompt: "check ci" }), "sess-1", { headless: true }),
    ).toEqual(["pi", "--print", "--session-id", "sess-1", "check ci"]);
  });

  it("passes the configured model, provider and thinking level", () => {
    const task = make({
      model: "claude-opus-5",
      provider: "anthropic",
      thinking: "high",
    });
    expect(buildAgentArgv(task, "sess-1", { headless: true })).toEqual([
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
    const argv = buildAgentArgv(make(), "sess-1", { headless: true });
    expect(argv).not.toContain("--model");
    expect(argv).not.toContain("--provider");
    expect(argv).not.toContain("--thinking");
  });

  it("keeps the same session flag whether or not the session already exists", () => {
    const task = make();
    expect(buildAgentArgv(task, "sess-1", { headless: false, resume: true })).toEqual(
      buildAgentArgv(task, "sess-1", { headless: false }),
    );
  });

  it("never puts the prompt on an interactive launch, so it can be typed instead", () => {
    const argv = buildAgentArgv(make({ prompt: "line one\nline two" }), "s", {
      headless: false,
    });
    expect(argv).not.toContain("line one\nline two");
  });
});

describe("buildAgentArgv for claude", () => {
  it("creates the session on the first run and resumes it afterwards", () => {
    const task = make({ agent: "claude", mode: "task", seed: SEED });
    expect(buildAgentArgv(task, SEED, { headless: false })).toEqual([
      "claude",
      "--session-id",
      SEED,
    ]);
    expect(
      buildAgentArgv(task, SEED, { headless: false, resume: true }),
    ).toEqual(["claude", "--resume", SEED]);
  });

  it("pins nothing when the session id is not a uuid, which claude rejects", () => {
    const task = make({ agent: "claude", mode: "task" });
    const argv = buildAgentArgv(task, "terax-st-abc", { headless: false });
    expect(argv).toEqual(["claude"]);
  });

  it("starts a fresh conversation for every routine run", () => {
    const task = make({ agent: "claude", mode: "routine", seed: SEED });
    expect(buildAgentArgv(task, SEED, { headless: false, resume: true })).toEqual([
      "claude",
    ]);
  });

  it("prints and carries the prompt when headless", () => {
    const task = make({ agent: "claude", mode: "routine", model: "sonnet" });
    expect(buildAgentArgv(task, "x", { headless: true })).toEqual([
      "claude",
      "--print",
      "--model",
      "sonnet",
      "check ci",
    ]);
  });

  it("never passes pi only options", () => {
    const task = make({
      agent: "claude",
      provider: "anthropic",
      thinking: "high",
    });
    const argv = buildAgentArgv(task, SEED, { headless: true });
    expect(argv).not.toContain("--provider");
    expect(argv).not.toContain("--thinking");
  });
});

describe("buildAgentArgv for codex", () => {
  it("launches interactively with the chosen model", () => {
    const task = make({ agent: "codex", model: "gpt-5.1-codex" });
    expect(buildAgentArgv(task, "x", { headless: false })).toEqual([
      "codex",
      "-m",
      "gpt-5.1-codex",
    ]);
  });

  it("resumes its most recent session, since codex mints its own ids", () => {
    const task = make({ agent: "codex", mode: "task" });
    expect(buildAgentArgv(task, "x", { headless: false, resume: true })).toEqual([
      "codex",
      "resume",
      "--last",
    ]);
    expect(buildAgentArgv(task, "x", { headless: true, resume: true })).toEqual([
      "codex",
      "exec",
      "resume",
      "--last",
      "check ci",
    ]);
  });

  it("runs non-interactively through exec, with the subcommand first", () => {
    const task = make({ agent: "codex", mode: "routine", model: "gpt-5.1" });
    expect(buildAgentArgv(task, "x", { headless: true, resume: true })).toEqual([
      "codex",
      "exec",
      "-m",
      "gpt-5.1",
      "check ci",
    ]);
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

  it("reopens a claude run by session id", () => {
    expect(
      recoverCommandLine(
        { cwd: "/dev", sessionId: SEED, agent: "claude" },
        "posix",
      ),
    ).toBe(`cd /dev && claude --resume ${SEED}`);
  });

  it("falls back to the last claude conversation when the id is not a uuid", () => {
    expect(
      recoverCommandLine(
        { cwd: "/dev", sessionId: "terax-st-abc-20260803T093000", agent: "claude" },
        "posix",
      ),
    ).toBe("cd /dev && claude --continue");
  });

  it("reopens the most recent codex session in the run directory", () => {
    expect(
      recoverCommandLine({ cwd: "/dev", sessionId: "x", agent: "codex" }, "posix"),
    ).toBe("cd /dev && codex resume --last");
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
