import { describe, expect, it } from "vitest";

import {
  taskInputFromCommand,
  taskPatchFromCommand,
  taskSummary,
} from "./commandBridge";
import { finishRun, newRun } from "./runs";
import { createTask, type ScheduledTask } from "./task";

const NOW = new Date(2026, 7, 3, 9).getTime();

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
    ...overrides,
  };
}

describe("taskInputFromCommand", () => {
  it("inherits the session directory when none is given", () => {
    const input = taskInputFromCommand(
      { name: "Nightly", prompt: "go", schedule: "daily:09:00" },
      "/Users/dev/from-session",
    );
    expect("error" in input).toBe(false);
    if ("error" in input) return;
    expect(input.cwd).toBe("/Users/dev/from-session");
    expect(input.schedule).toEqual({
      kind: "weekly",
      days: [0, 1, 2, 3, 4, 5, 6],
      time: "09:00",
    });
  });

  it("prefers an explicit directory", () => {
    const input = taskInputFromCommand(
      { name: "n", prompt: "p", schedule: "every:5m", cwd: "/tmp/explicit" },
      "/Users/dev/from-session",
    );
    if ("error" in input) throw new Error(input.error);
    expect(input.cwd).toBe("/tmp/explicit");
  });

  it("attaches a session bound to the resolved directory", () => {
    const input = taskInputFromCommand(
      { name: "n", prompt: "p", schedule: "every:5m", sessionId: "019fc4f0" },
      "/Users/dev/from-session",
    );
    if ("error" in input) throw new Error(input.error);
    expect(input.sessions).toEqual([
      { id: "019fc4f0", cwd: "/Users/dev/from-session" },
    ]);
  });

  it("carries the optional configuration through", () => {
    const input = taskInputFromCommand(
      {
        name: "n",
        prompt: "p",
        schedule: "every:5m",
        target: "headless",
        mode: "routine",
        missed: "skip",
        overlap: "parallel",
        model: "claude-opus-5",
        maxRuns: 3,
        tabId: 7,
      },
      "/tmp",
    );
    if ("error" in input) throw new Error(input.error);
    expect(input.target).toBe("headless");
    expect(input.mode).toBe("routine");
    expect(input.missed).toBe("skip");
    expect(input.overlap).toBe("parallel");
    expect(input.model).toBe("claude-opus-5");
    expect(input.maxRuns).toBe(3);
    expect(input.tabId).toBe(7);
  });

  it("refuses to guess a missing name, prompt or schedule", () => {
    expect(
      taskInputFromCommand({ prompt: "p", schedule: "every:5m" }, "/tmp"),
    ).toEqual({ error: expect.stringContaining("name") });
    expect(
      taskInputFromCommand({ name: "n", schedule: "every:5m" }, "/tmp"),
    ).toEqual({ error: expect.stringContaining("prompt") });
    expect(taskInputFromCommand({ name: "n", prompt: "p" }, "/tmp")).toEqual({
      error: expect.stringContaining("schedule"),
    });
    expect(
      taskInputFromCommand(
        { name: " ", prompt: "p", schedule: "every:5m" },
        "/tmp",
      ),
    ).toEqual({ error: expect.stringContaining("name") });
  });

  it("refuses when no working directory can be inferred", () => {
    expect(
      taskInputFromCommand({ name: "n", prompt: "p", schedule: "every:5m" }, ""),
    ).toEqual({ error: expect.stringContaining("working directory") });
  });
});

describe("taskPatchFromCommand", () => {
  it("patches only the given fields", () => {
    const patch = taskPatchFromCommand({ name: "  Renamed " }, make());
    if ("error" in patch) throw new Error(patch.error);
    expect(patch).toEqual({ name: "Renamed" });
  });

  it("parses a new schedule spec", () => {
    const patch = taskPatchFromCommand({ schedule: "every:2h" }, make());
    if ("error" in patch) throw new Error(patch.error);
    expect(patch.schedule).toEqual({ kind: "everyN", minutes: 120 });
  });

  it("rejects an invalid schedule spec instead of clearing the schedule", () => {
    expect(taskPatchFromCommand({ schedule: "hourly" }, make())).toEqual({
      error: expect.stringContaining("schedule"),
    });
  });

  it("binds a new session to the patched directory", () => {
    const patch = taskPatchFromCommand(
      { cwd: "/tmp/new", sessionId: "sess" },
      make(),
    );
    if ("error" in patch) throw new Error(patch.error);
    expect(patch.sessions).toEqual([{ id: "sess", cwd: "/tmp/new" }]);
  });

  it("binds a new session to the existing directory when the cwd is unchanged", () => {
    const patch = taskPatchFromCommand({ sessionId: "sess" }, make());
    if ("error" in patch) throw new Error(patch.error);
    expect(patch.sessions).toEqual([
      { id: "sess", cwd: "/Users/dev/project" },
    ]);
  });
});

describe("taskSummary", () => {
  it("reports the schedule both as a spec and as a label", () => {
    const summary = taskSummary(make({ nextRunAt: NOW + 3_600_000 }), [], NOW);
    expect(summary.schedule).toBe("every:1h");
    expect(summary.scheduleLabel).toBe("Every hour");
    expect(summary.nextRun).toBe("in 1h");
  });

  it("includes the prompt, unlike the app snapshot", () => {
    expect(taskSummary(make(), [], NOW).prompt).toBe("check ci");
  });

  it("aggregates run accounting", () => {
    const runs = [
      finishRun(
        newRun(
          {
            taskId: "st-1",
            sessionId: "s1",
            cwd: "/tmp",
            trigger: "schedule",
            attempt: 1,
          },
          NOW,
        ),
        {
          status: "ok",
          endedAt: NOW + 60_000,
          usage: {
            input: 1,
            output: 2,
            cacheRead: 3,
            cacheWrite: 4,
            reasoning: 5,
            totalTokens: 100,
            costTotal: 0.5,
          },
        },
      ),
    ];
    const summary = taskSummary(make(), runs, NOW);
    expect(summary.totals).toEqual({
      runs: 1,
      failures: 0,
      durationMs: 60_000,
      totalTokens: 100,
      costTotal: 0.5,
    });
    expect(summary.lastRun?.status).toBe("ok");
    expect(summary.lastRun?.totalTokens).toBe(100);
  });

  it("reports no last run for a task that never ran", () => {
    expect(taskSummary(make(), [], NOW).lastRun).toBeNull();
  });

  it("normalises absent optionals to null rather than omitting them", () => {
    const summary = taskSummary(make(), [], NOW);
    expect(summary.tabId).toBeNull();
    expect(summary.maxRuns).toBeNull();
    expect(summary.lastRunAt).toBeNull();
  });
});
