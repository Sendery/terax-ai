import { describe, expect, it } from "vitest";

import {
  aggregateTaskUsage,
  appendRun,
  emptyUsage,
  finishRun,
  isTaskRun,
  MAX_RUNS_PER_TASK,
  newRun,
  runDurationMs,
  type RunUsage,
  type TaskRun,
} from "./runs";

const START = 1_767_000_000_000;

function usage(overrides: Partial<RunUsage> = {}): RunUsage {
  return {
    input: 10,
    output: 20,
    cacheRead: 30,
    cacheWrite: 40,
    reasoning: 5,
    totalTokens: 100,
    costTotal: 0.25,
    ...overrides,
  };
}

function started(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    ...newRun(
      {
        taskId: "st-1",
        sessionId: "019fc4f0",
        cwd: "/Users/dev/project",
        trigger: "schedule",
        attempt: 1,
      },
      START,
    ),
    ...overrides,
  };
}

describe("newRun", () => {
  it("starts in the running state with no accounting yet", () => {
    const run = started();
    expect(run.status).toBe("running");
    expect(run.startedAt).toBe(START);
    expect(run.endedAt).toBeUndefined();
    expect(run.usage).toBeUndefined();
    expect(run.id).not.toBe(started().id);
  });
});

describe("finishRun", () => {
  it("records success with accounting and duration", () => {
    const run = finishRun(started(), {
      status: "ok",
      endedAt: START + 90_000,
      usage: usage(),
      model: "claude-opus-5",
      stopReason: "endTurn",
      exitCode: 0,
    });
    expect(run.status).toBe("ok");
    expect(runDurationMs(run)).toBe(90_000);
    expect(run.usage?.totalTokens).toBe(100);
    expect(run.model).toBe("claude-opus-5");
  });

  it("keeps a descriptive message for a failure", () => {
    const run = finishRun(started(), {
      status: "failed",
      endedAt: START + 1_000,
      exitCode: 127,
      message: "pi: command not found",
    });
    expect(run.status).toBe("failed");
    expect(run.message).toBe("pi: command not found");
    expect(run.exitCode).toBe(127);
  });

  it("does not invent accounting when the run produced none", () => {
    const run = finishRun(started(), { status: "timeout", endedAt: START + 10 });
    expect(run.usage).toBeUndefined();
  });
});

describe("runDurationMs", () => {
  it("is zero while the run is still open", () => {
    expect(runDurationMs(started())).toBe(0);
  });

  it("never reports a negative duration from a clock skew", () => {
    expect(runDurationMs(started({ endedAt: START - 5_000 }))).toBe(0);
  });
});

describe("appendRun", () => {
  it("keeps the newest run first", () => {
    const older = started();
    const newer = started({ startedAt: START + 1_000 });
    const list = appendRun(appendRun([], older), newer);
    expect(list[0].id).toBe(newer.id);
    expect(list).toHaveLength(2);
  });

  it("bounds retained history per task", () => {
    let list: readonly TaskRun[] = [];
    for (let i = 0; i < MAX_RUNS_PER_TASK + 25; i += 1) {
      list = appendRun(list, started({ startedAt: START + i }));
    }
    expect(list).toHaveLength(MAX_RUNS_PER_TASK);
  });

  it("replaces a run in place when it is updated", () => {
    const run = started();
    const list = appendRun([run], finishRun(run, {
      status: "ok",
      endedAt: START + 10,
    }));
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe("ok");
  });
});

describe("aggregateTaskUsage", () => {
  it("sums tokens, cost and time across runs", () => {
    const runs = [
      finishRun(started(), {
        status: "ok",
        endedAt: START + 60_000,
        usage: usage(),
      }),
      finishRun(started({ startedAt: START + 100_000 }), {
        status: "ok",
        endedAt: START + 130_000,
        usage: usage({ totalTokens: 400, costTotal: 1 }),
      }),
    ];
    const total = aggregateTaskUsage(runs);
    expect(total.runs).toBe(2);
    expect(total.usage.totalTokens).toBe(500);
    expect(total.usage.costTotal).toBeCloseTo(1.25);
    expect(total.durationMs).toBe(90_000);
    expect(total.failures).toBe(0);
  });

  it("counts failures and ignores runs without accounting", () => {
    const runs = [
      finishRun(started(), { status: "failed", endedAt: START + 1_000 }),
      finishRun(started(), { status: "timeout", endedAt: START + 2_000 }),
      started(),
    ];
    const total = aggregateTaskUsage(runs);
    expect(total.failures).toBe(2);
    expect(total.usage).toEqual(emptyUsage());
  });

  it("returns a zeroed total for no runs", () => {
    const total = aggregateTaskUsage([]);
    expect(total.runs).toBe(0);
    expect(total.durationMs).toBe(0);
    expect(total.usage).toEqual(emptyUsage());
  });
});

describe("isTaskRun", () => {
  it("accepts open and finished runs", () => {
    expect(isTaskRun(started())).toBe(true);
    expect(
      isTaskRun(finishRun(started(), { status: "ok", endedAt: START + 1 })),
    ).toBe(true);
  });

  it("rejects malformed stored runs", () => {
    const invalid: unknown[] = [
      null,
      "run",
      {},
      { ...started(), id: "" },
      { ...started(), taskId: "" },
      { ...started(), status: "maybe" },
      { ...started(), trigger: "cosmic" },
      { ...started(), startedAt: -1 },
      { ...started(), attempt: 0 },
      { ...started(), usage: { totalTokens: "many" } },
    ];
    for (const candidate of invalid) expect(isTaskRun(candidate)).toBe(false);
  });
});
