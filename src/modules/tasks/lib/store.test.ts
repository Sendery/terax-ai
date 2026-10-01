import { describe, expect, it } from "vitest";

import { createTask, type ScheduledTask } from "./task";
import {
  parseStoredPaused,
  parseStoredRuns,
  parseStoredTasks,
  TASKS_STORE_PATH,
  toStoredRuns,
  toStoredTasks,
} from "./store";
import { finishRun, newRun, type TaskRun } from "./runs";

const NOW = 1_767_000_000_000;

function task(name: string): ScheduledTask {
  return createTask(
    {
      name,
      prompt: "check ci",
      cwd: "/Users/dev/project",
      schedule: { kind: "everyN", minutes: 60 },
    },
    NOW,
  );
}

function run(taskId: string): TaskRun {
  return finishRun(
    newRun(
      { taskId, sessionId: "019fc4f0", cwd: "/tmp", trigger: "schedule", attempt: 1 },
      NOW,
    ),
    { status: "ok", endedAt: NOW + 1_000 },
  );
}

describe("TASKS_STORE_PATH", () => {
  it("is a dedicated store file, separate from settings and sessions", () => {
    expect(TASKS_STORE_PATH).toBe("terax-scheduled-tasks.json");
  });
});

describe("parseStoredTasks", () => {
  it("round-trips a persisted list", () => {
    const tasks = [task("one"), task("two")];
    expect(parseStoredTasks(toStoredTasks(tasks))).toEqual(tasks);
  });

  it("returns an empty list for a missing or non-array value", () => {
    for (const value of [undefined, null, {}, "tasks", 7]) {
      expect(parseStoredTasks(value)).toEqual([]);
    }
  });

  it("drops invalid entries instead of failing the whole hydration", () => {
    const good = task("keep");
    const stored = [good, { id: "broken" }, null, { ...good, schedule: null }];
    expect(parseStoredTasks(stored)).toEqual([good]);
  });

  it("migrates a task stored before agents existed to pi", () => {
    const legacy = { ...task("legacy") } as Record<string, unknown>;
    delete legacy.agent;
    delete legacy.seed;
    const [restored] = parseStoredTasks([legacy]);
    expect(restored.agent).toBe("pi");
    // No seed is invented: the task keeps the session id it already used.
    expect(restored.seed).toBeUndefined();
  });

  it("drops an entry whose agent is not a supported CLI", () => {
    expect(parseStoredTasks([{ ...task("bad"), agent: "gemini" }])).toEqual([]);
  });

  it("drops duplicate ids, keeping the first", () => {
    const first = task("first");
    const clone = { ...task("second"), id: first.id };
    expect(parseStoredTasks([first, clone])).toEqual([first]);
  });
});

describe("parseStoredRuns", () => {
  it("round-trips history keyed by task", () => {
    const history = { "st-1": [run("st-1")] };
    expect(parseStoredRuns(toStoredRuns(history))).toEqual(history);
  });

  it("returns an empty map for a malformed value", () => {
    for (const value of [undefined, null, [], "runs"]) {
      expect(parseStoredRuns(value)).toEqual({});
    }
  });

  it("drops invalid runs and empty buckets", () => {
    const good = run("st-1");
    const stored = {
      "st-1": [good, { id: "nope" }],
      "st-2": [{ id: "nope" }],
      "st-3": "not-an-array",
    };
    expect(parseStoredRuns(stored)).toEqual({ "st-1": [good] });
  });

  it("discards a bucket whose runs belong to another task", () => {
    expect(parseStoredRuns({ "st-9": [run("st-1")] })).toEqual({});
  });
});

describe("parseStoredPaused", () => {
  it("reads the global kill switch", () => {
    expect(parseStoredPaused(true)).toBe(true);
    expect(parseStoredPaused(false)).toBe(false);
  });

  it("defaults to not paused for anything else", () => {
    for (const value of [undefined, null, "true", 1, {}]) {
      expect(parseStoredPaused(value)).toBe(false);
    }
  });
});
