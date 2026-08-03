import { describe, expect, it } from "vitest";

import { dueTasks, earliestDeadline } from "./scheduling";
import { createTask, type ScheduledTask } from "./task";

const NOW = new Date(2026, 7, 3, 9).getTime();

function make(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    ...createTask(
      {
        name: "t",
        prompt: "p",
        cwd: "/tmp",
        schedule: { kind: "everyN", minutes: 60 },
      },
      NOW,
    ),
    ...overrides,
  };
}

describe("earliestDeadline", () => {
  it("returns null when nothing is scheduled, so the native timer stays idle", () => {
    expect(earliestDeadline([], false)).toBeNull();
    expect(earliestDeadline([make({ nextRunAt: null })], false)).toBeNull();
  });

  it("returns the soonest pending instant", () => {
    const tasks = [
      make({ nextRunAt: NOW + 5_000 }),
      make({ nextRunAt: NOW + 1_000 }),
      make({ nextRunAt: null }),
    ];
    expect(earliestDeadline(tasks, false)).toBe(NOW + 1_000);
  });

  it("ignores disabled and exhausted tasks", () => {
    const tasks = [
      make({ nextRunAt: NOW + 1_000, enabled: false }),
      make({ nextRunAt: NOW + 2_000, maxRuns: 1, runCount: 1 }),
      make({ nextRunAt: NOW + 9_000 }),
    ];
    expect(earliestDeadline(tasks, false)).toBe(NOW + 9_000);
  });

  it("disarms entirely while the global pause is engaged", () => {
    expect(earliestDeadline([make({ nextRunAt: NOW + 1_000 })], true)).toBeNull();
  });

  it("keeps an overdue instant so the dispatcher fires immediately", () => {
    expect(earliestDeadline([make({ nextRunAt: NOW - 60_000 })], false)).toBe(
      NOW - 60_000,
    );
  });
});

describe("dueTasks", () => {
  it("selects every task at or past its instant", () => {
    const a = make({ nextRunAt: NOW - 1 });
    const b = make({ nextRunAt: NOW });
    const c = make({ nextRunAt: NOW + 1 });
    expect(dueTasks([a, b, c], NOW).map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("never selects a disabled, unscheduled or exhausted task", () => {
    const tasks = [
      make({ nextRunAt: NOW - 1, enabled: false }),
      make({ nextRunAt: null }),
      make({ nextRunAt: NOW - 1, maxRuns: 2, runCount: 2 }),
    ];
    expect(dueTasks(tasks, NOW)).toEqual([]);
  });

  it("orders the due tasks oldest first so a backlog drains in order", () => {
    const late = make({ nextRunAt: NOW - 10_000 });
    const recent = make({ nextRunAt: NOW - 1_000 });
    expect(dueTasks([recent, late], NOW).map((t) => t.id)).toEqual([
      late.id,
      recent.id,
    ]);
  });
});
