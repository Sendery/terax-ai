import { describe, expect, it } from "vitest";

import {
  admitOccurrence,
  isRunTimedOut,
  MAX_QUEUE_DEPTH,
  resolveFailure,
  resolveMissed,
  type QueueState,
} from "./policies";
import { createTask, type ScheduledTask } from "./task";

const HOUR = 3_600_000;
const NINE = new Date(2026, 7, 3, 9).getTime();
const TWELVE_TWENTY = new Date(2026, 7, 3, 12, 20).getTime();

function hourly(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    ...createTask(
      {
        name: "Watch CI",
        prompt: "check ci",
        cwd: "/tmp",
        schedule: { kind: "everyN", minutes: 60 },
      },
      NINE,
    ),
    lastRunAt: NINE,
    ...overrides,
  };
}

describe("resolveMissed", () => {
  it("dispatches a single recovery run under the default policy", () => {
    const outcome = resolveMissed(hourly(), TWELVE_TWENTY);
    expect(outcome.missed).toBe(3);
    expect(outcome.dispatch).toBe(1);
    expect(outcome.awaitingConfirmation).toBe(false);
  });

  it("dispatches nothing under skip but still reports what was lost", () => {
    const outcome = resolveMissed(hourly({ missed: "skip" }), TWELVE_TWENTY);
    expect(outcome.missed).toBe(3);
    expect(outcome.dispatch).toBe(0);
  });

  it("dispatches every lost slot under runAll", () => {
    const outcome = resolveMissed(hourly({ missed: "runAll" }), TWELVE_TWENTY);
    expect(outcome.dispatch).toBe(3);
  });

  it("defers to the user under askOnResume", () => {
    const outcome = resolveMissed(
      hourly({ missed: "askOnResume" }),
      TWELVE_TWENTY,
    );
    expect(outcome.missed).toBe(3);
    expect(outcome.dispatch).toBe(0);
    expect(outcome.awaitingConfirmation).toBe(true);
  });

  it("reports nothing to recover when the cadence is on time", () => {
    const outcome = resolveMissed(
      hourly({ lastRunAt: TWELVE_TWENTY - 60_000 }),
      TWELVE_TWENTY,
    );
    expect(outcome.missed).toBe(0);
    expect(outcome.dispatch).toBe(0);
    expect(outcome.awaitingConfirmation).toBe(false);
  });

  it("never recovers a disabled task", () => {
    const outcome = resolveMissed(hourly({ enabled: false }), TWELVE_TWENTY);
    expect(outcome.missed).toBe(0);
    expect(outcome.dispatch).toBe(0);
  });

  it("clamps recovery to the remaining run budget", () => {
    const outcome = resolveMissed(
      hourly({ missed: "runAll", maxRuns: 5, runCount: 4 }),
      TWELVE_TWENTY,
    );
    expect(outcome.missed).toBe(3);
    expect(outcome.dispatch).toBe(1);
  });

  it("dispatches nothing once the run budget is spent", () => {
    const outcome = resolveMissed(
      hourly({ missed: "runAll", maxRuns: 5, runCount: 5 }),
      TWELVE_TWENTY,
    );
    expect(outcome.dispatch).toBe(0);
  });
});

describe("admitOccurrence", () => {
  const idle: QueueState = { running: [], pending: [] };

  it("runs immediately when the task is not already running", () => {
    expect(admitOccurrence(hourly(), idle).decision).toBe("run");
  });

  it("caps the queue at one pending occurrence", () => {
    expect(MAX_QUEUE_DEPTH).toBe(1);
  });

  it("queues the second occurrence while the first is running", () => {
    const task = hourly();
    const state: QueueState = {
      running: [{ taskId: task.id, startedAt: NINE }],
      pending: [],
    };
    expect(admitOccurrence(task, state).decision).toBe("queue");
  });

  it("skips and notifies once the queue is already full", () => {
    const task = hourly();
    const state: QueueState = {
      running: [{ taskId: task.id, startedAt: NINE }],
      pending: [task.id],
    };
    const outcome = admitOccurrence(task, state);
    expect(outcome.decision).toBe("skip");
    expect(outcome.notify).toBe(true);
  });

  it("skips without queueing under the skip policy", () => {
    const task = hourly({ overlap: "skip" });
    const state: QueueState = {
      running: [{ taskId: task.id, startedAt: NINE }],
      pending: [],
    };
    const outcome = admitOccurrence(task, state);
    expect(outcome.decision).toBe("skip");
    expect(outcome.notify).toBe(true);
  });

  it("overlaps freely under the parallel policy", () => {
    const task = hourly({ overlap: "parallel" });
    const state: QueueState = {
      running: [
        { taskId: task.id, startedAt: NINE },
        { taskId: task.id, startedAt: NINE + 60_000 },
      ],
      pending: [],
    };
    expect(admitOccurrence(task, state).decision).toBe("run");
  });

  it("ignores other tasks occupying the runner", () => {
    const task = hourly();
    const state: QueueState = {
      running: [{ taskId: "another", startedAt: NINE }],
      pending: ["another"],
    };
    expect(admitOccurrence(task, state).decision).toBe("run");
  });

  it("refuses a disabled task", () => {
    const outcome = admitOccurrence(hourly({ enabled: false }), idle);
    expect(outcome.decision).toBe("skip");
    expect(outcome.notify).toBe(false);
  });

  it("refuses a task whose run budget is spent", () => {
    const outcome = admitOccurrence(
      hourly({ maxRuns: 2, runCount: 2 }),
      idle,
    );
    expect(outcome.decision).toBe("skip");
  });
});

describe("isRunTimedOut", () => {
  it("is false inside the timeout window", () => {
    expect(isRunTimedOut({ taskId: "a", startedAt: NINE }, NINE + 29 * 60_000)).toBe(
      false,
    );
  });

  it("is true past the timeout window", () => {
    expect(isRunTimedOut({ taskId: "a", startedAt: NINE }, NINE + 31 * 60_000)).toBe(
      true,
    );
  });
});

describe("resolveFailure", () => {
  it("retries with growing backoff while attempts remain", () => {
    const task = hourly({ failure: { retries: 3, thenDisable: true } });
    const first = resolveFailure(task, 1);
    const second = resolveFailure(task, 2);
    expect(first.action).toBe("retry");
    expect(second.action).toBe("retry");
    expect(second.delayMs).toBeGreaterThan(first.delayMs);
  });

  it("disables the task with a red notification after the last retry", () => {
    const task = hourly({ failure: { retries: 2, thenDisable: true } });
    const outcome = resolveFailure(task, 3);
    expect(outcome.action).toBe("disable");
    expect(outcome.notify).toBe("error");
  });

  it("gives up without disabling when the policy says so", () => {
    const task = hourly({ failure: { retries: 1, thenDisable: false } });
    const outcome = resolveFailure(task, 2);
    expect(outcome.action).toBe("giveUp");
    expect(outcome.notify).toBe("error");
  });

  it("never waits longer than the run timeout between retries", () => {
    const task = hourly({ failure: { retries: 20, thenDisable: true } });
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      expect(resolveFailure(task, attempt).delayMs).toBeLessThanOrEqual(HOUR);
    }
  });
});
