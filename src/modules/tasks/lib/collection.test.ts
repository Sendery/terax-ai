import { describe, expect, it } from "vitest";

import {
  applyMissedGrouping,
  cloneTask,
  moveTask,
  recentTaskDefaults,
  regenerateSeed,
  removeTask,
  reschedule,
  setTaskEnabled,
  sortTasksByNextRun,
  updateTask,
  upsertTask,
} from "./collection";
import { createTask, type ScheduledTask } from "./task";

const NOW = new Date(2026, 7, 3, 9).getTime();

function make(name: string, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    ...createTask(
      {
        name,
        prompt: "check ci",
        cwd: "/tmp",
        schedule: { kind: "everyN", minutes: 60 },
      },
      NOW,
    ),
    ...overrides,
  };
}

describe("cloneTask", () => {
  const source = make("Nightly", {
    agent: "claude",
    model: "sonnet",
    seed: "739c3224-00f8-4504-99a4-06708d16dfeb",
    sessions: [{ id: "739c3224-00f8-4504-99a4-06708d16dfeb", cwd: "/tmp" }],
    runCount: 7,
    lastRunAt: NOW,
    nextRunAt: NOW + 60_000,
    tabId: 3,
  });

  it("copies the configuration a user would otherwise retype", () => {
    const copy = cloneTask(source, NOW + 1_000);
    expect(copy.prompt).toBe(source.prompt);
    expect(copy.schedule).toEqual(source.schedule);
    expect(copy.agent).toBe("claude");
    expect(copy.model).toBe("sonnet");
    expect(copy.cwd).toBe(source.cwd);
    expect(copy.missed).toBe(source.missed);
    expect(copy.overlap).toBe(source.overlap);
    expect(copy.failure).toEqual(source.failure);
  });

  it("is a separate task with its own history and session", () => {
    const copy = cloneTask(source, NOW + 1_000);
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Nightly (copy)");
    expect(copy.runCount).toBe(0);
    expect(copy.lastRunAt).toBeUndefined();
    expect(copy.sessions).toEqual([]);
    expect(copy.seed).not.toBe(source.seed);
    expect(copy.createdAt).toBe(NOW + 1_000);
    // The clone must not inherit the tab the original owns.
    expect(copy.tabId).toBeUndefined();
  });

  it("lands disabled so it cannot fire while it is still being edited", () => {
    expect(cloneTask(source, NOW).enabled).toBe(false);
    expect(cloneTask(source, NOW).nextRunAt).toBeNull();
  });

  it("numbers further copies instead of repeating one name", () => {
    const first = cloneTask(source, NOW, [source]);
    const second = cloneTask(source, NOW, [source, first]);
    expect(first.name).toBe("Nightly (copy)");
    expect(second.name).toBe("Nightly (copy 2)");
  });
});

describe("regenerateSeed", () => {
  it("drops the session the task was pinned to and names a new one", () => {
    const task = make("Nightly", {
      seed: "739c3224-00f8-4504-99a4-06708d16dfeb",
      sessions: [{ id: "739c3224-00f8-4504-99a4-06708d16dfeb", cwd: "/tmp" }],
    });
    const next = regenerateSeed(task);
    expect(next.seed).not.toBe(task.seed);
    expect(next.seed).toMatch(/^[0-9a-f-]{36}$/);
    expect(next.sessions).toEqual([]);
  });

  it("keeps everything else, including the run budget already spent", () => {
    const task = make("Nightly", { runCount: 4, maxRuns: 10 });
    const next = regenerateSeed(task);
    expect(next.runCount).toBe(4);
    expect(next.maxRuns).toBe(10);
    expect(next.id).toBe(task.id);
    expect(next.name).toBe(task.name);
  });
});

describe("recentTaskDefaults", () => {
  it("has nothing to offer for an empty list", () => {
    expect(recentTaskDefaults([])).toBeNull();
  });

  it("reuses the parameters of the most recently created task", () => {
    const older = make("older", {
      createdAt: NOW,
      agent: "pi",
      model: "opus",
      target: "headless",
    });
    const newer = make("newer", {
      createdAt: NOW + 5_000,
      agent: "codex",
      model: "gpt-5.1-codex",
      target: "tab",
      mode: "routine",
      missed: "skip",
      overlap: "parallel",
      schedule: { kind: "weekly", days: [1], time: "07:30" },
      failure: { retries: 0, thenDisable: false },
      cwd: "/Users/dev/api",
    });
    const defaults = recentTaskDefaults([older, newer]);
    expect(defaults).toEqual({
      schedule: { kind: "weekly", days: [1], time: "07:30" },
      target: "tab",
      mode: "routine",
      agent: "codex",
      model: "gpt-5.1-codex",
      provider: undefined,
      thinking: undefined,
      missed: "skip",
      overlap: "parallel",
      failure: { retries: 0, thenDisable: false },
      cwd: "/Users/dev/api",
    });
  });

  it("never carries the previous prompt, name or session over", () => {
    const defaults = recentTaskDefaults([make("one")]);
    expect(defaults).not.toBeNull();
    expect(Object.keys(defaults ?? {})).not.toContain("prompt");
    expect(Object.keys(defaults ?? {})).not.toContain("name");
    expect(Object.keys(defaults ?? {})).not.toContain("seed");
  });
});

describe("upsertTask", () => {
  it("appends a new task", () => {
    const a = make("a");
    const b = make("b");
    expect(upsertTask([a], b).map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("replaces an existing task in place", () => {
    const a = make("a");
    const b = make("b");
    const updated = { ...a, name: "renamed" };
    const list = upsertTask([a, b], updated);
    expect(list.map((t) => t.name)).toEqual(["renamed", "b"]);
  });
});

describe("removeTask", () => {
  it("removes by id and leaves the rest untouched", () => {
    const a = make("a");
    const b = make("b");
    expect(removeTask([a, b], a.id)).toEqual([b]);
  });

  it("is a no-op for an unknown id", () => {
    const a = make("a");
    expect(removeTask([a], "missing")).toEqual([a]);
  });
});

describe("updateTask", () => {
  it("applies a shallow patch", () => {
    const a = make("a");
    const list = updateTask([a], a.id, { name: "b", prompt: "new" });
    expect(list[0].name).toBe("b");
    expect(list[0].prompt).toBe("new");
  });

  it("cannot rewrite the identity or the creation stamp", () => {
    const a = make("a");
    const list = updateTask([a], a.id, {
      id: "hijacked",
      createdAt: 0,
    } as Partial<ScheduledTask>);
    expect(list[0].id).toBe(a.id);
    expect(list[0].createdAt).toBe(NOW);
  });

  it("normalises an unlimited run budget to undefined", () => {
    const a = make("a", { maxRuns: 5 });
    const list = updateTask([a], a.id, { maxRuns: 0 });
    expect(list[0].maxRuns).toBeUndefined();
  });
});

describe("setTaskEnabled", () => {
  it("disabling clears the pending schedule", () => {
    const a = make("a", { nextRunAt: NOW + 60_000 });
    const list = setTaskEnabled([a], a.id, false, NOW);
    expect(list[0].enabled).toBe(false);
    expect(list[0].nextRunAt).toBeNull();
  });

  it("enabling recomputes the next run", () => {
    const a = make("a", { enabled: false, nextRunAt: null });
    const list = setTaskEnabled([a], a.id, true, NOW);
    expect(list[0].enabled).toBe(true);
    expect(list[0].nextRunAt).toBe(NOW + 3_600_000);
  });
});

describe("reschedule", () => {
  it("derives the next run from the schedule", () => {
    const a = make("a", { lastRunAt: NOW });
    expect(reschedule(a, NOW + 10).nextRunAt).toBe(NOW + 3_600_000);
  });

  it("clears the next run for a disabled task", () => {
    const a = make("a", { enabled: false });
    expect(reschedule(a, NOW).nextRunAt).toBeNull();
  });

  it("clears the next run once the budget is spent", () => {
    const a = make("a", { maxRuns: 1, runCount: 1 });
    expect(reschedule(a, NOW).nextRunAt).toBeNull();
  });

  it("clears the next run for a manual task", () => {
    const a = make("a", { schedule: { kind: "manual" } });
    expect(reschedule(a, NOW).nextRunAt).toBeNull();
  });
});

describe("sortTasksByNextRun", () => {
  it("puts the soonest first and unscheduled last", () => {
    const soon = make("soon", { nextRunAt: NOW + 1_000 });
    const later = make("later", { nextRunAt: NOW + 5_000 });
    const never = make("never", { nextRunAt: null });
    expect(
      sortTasksByNextRun([never, later, soon]).map((t) => t.name),
    ).toEqual(["soon", "later", "never"]);
  });

  it("breaks ties by name so the order never flickers", () => {
    const b = make("b", { nextRunAt: NOW });
    const a = make("a", { nextRunAt: NOW });
    expect(sortTasksByNextRun([b, a]).map((t) => t.name)).toEqual(["a", "b"]);
  });
});

describe("moveTask", () => {
  it("reorders within bounds", () => {
    const a = make("a");
    const b = make("b");
    const c = make("c");
    expect(moveTask([a, b, c], c.id, 0).map((t) => t.name)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("clamps an out of range target", () => {
    const a = make("a");
    const b = make("b");
    expect(moveTask([a, b], a.id, 99).map((t) => t.name)).toEqual(["b", "a"]);
  });
});

describe("applyMissedGrouping", () => {
  it("groups by recovery policy in a stable order", () => {
    const tasks = [
      make("skip one", { missed: "skip" }),
      make("ask one", { missed: "askOnResume" }),
      make("once one", { missed: "runOnce" }),
    ];
    expect(applyMissedGrouping(tasks).map((g) => g.policy)).toEqual([
      "runOnce",
      "skip",
      "runAll",
      "askOnResume",
    ]);
  });

  it("keeps empty groups out of the way but reports them", () => {
    const groups = applyMissedGrouping([make("only", { missed: "runAll" })]);
    const runAll = groups.find((g) => g.policy === "runAll");
    expect(runAll?.tasks).toHaveLength(1);
    expect(groups.filter((g) => g.tasks.length === 0)).toHaveLength(3);
  });
});
