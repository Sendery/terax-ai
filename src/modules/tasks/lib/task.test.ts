import { describe, expect, it } from "vitest";

import {
  createTask,
  DEFAULT_FAILURE_POLICY,
  isScheduledTask,
  newTaskId,
  RUN_TIMEOUT_MS,
  type ScheduledTask,
} from "./task";

const NOW = 1_767_000_000_000;

function base(): ScheduledTask {
  return createTask(
    {
      name: "Watch CI",
      prompt: "Review the CI status and summarise failures",
      cwd: "/Users/dev/project",
      schedule: { kind: "everyN", minutes: 60 },
    },
    NOW,
  );
}

describe("newTaskId", () => {
  it("produces distinct opaque ids", () => {
    const ids = new Set(Array.from({ length: 64 }, newTaskId));
    expect(ids.size).toBe(64);
    for (const id of ids) expect(id).toMatch(/^st-[a-z0-9-]{6,}$/);
  });
});

describe("createTask", () => {
  it("applies the agreed defaults", () => {
    const task = base();
    expect(task.enabled).toBe(true);
    expect(task.mode).toBe("task");
    expect(task.target).toBe("tab");
    expect(task.missed).toBe("runOnce");
    expect(task.overlap).toBe("queue");
    expect(task.failure).toEqual(DEFAULT_FAILURE_POLICY);
    expect(task.runCount).toBe(0);
    expect(task.maxRuns).toBeUndefined();
    expect(task.createdAt).toBe(NOW);
    expect(task.sessions).toEqual([]);
  });

  it("trims the name and keeps the prompt verbatim", () => {
    const task = createTask(
      {
        name: "  Nightly  ",
        prompt: "  line one\n  line two  ",
        cwd: "/tmp",
        schedule: { kind: "manual" },
      },
      NOW,
    );
    expect(task.name).toBe("Nightly");
    expect(task.prompt).toBe("  line one\n  line two  ");
  });

  it("carries an unlimited run budget as undefined, never zero", () => {
    const task = createTask(
      {
        name: "Forever",
        prompt: "go",
        cwd: "/tmp",
        schedule: { kind: "everyN", minutes: 5 },
        maxRuns: 0,
      },
      NOW,
    );
    expect(task.maxRuns).toBeUndefined();
  });

  it("keeps a per task run timeout of thirty minutes", () => {
    expect(RUN_TIMEOUT_MS).toBe(30 * 60_000);
  });
});

describe("isScheduledTask", () => {
  it("accepts a freshly created task", () => {
    expect(isScheduledTask(base())).toBe(true);
  });

  it("accepts a fully populated task", () => {
    const task: ScheduledTask = {
      ...base(),
      mode: "routine",
      target: "headless",
      sessions: [{ id: "019fc4f0", cwd: "/Users/dev/project", label: "main" }],
      tabId: 4,
      color: "teal",
      model: "claude-opus-5",
      provider: "anthropic",
      thinking: "high",
      missed: "askOnResume",
      overlap: "skip",
      failure: { retries: 0, thenDisable: false },
      maxRuns: 10,
      runCount: 3,
      lastRunAt: NOW,
      nextRunAt: NOW + 60_000,
    };
    expect(isScheduledTask(task)).toBe(true);
  });

  it("rejects malformed stored entries", () => {
    const invalid: unknown[] = [
      null,
      undefined,
      "task",
      [],
      {},
      { ...base(), id: "" },
      { ...base(), name: "" },
      { ...base(), prompt: "" },
      { ...base(), cwd: "" },
      { ...base(), mode: "other" },
      { ...base(), target: "window" },
      { ...base(), missed: "maybe" },
      { ...base(), overlap: "later" },
      { ...base(), enabled: "yes" },
      { ...base(), runCount: -1 },
      { ...base(), runCount: 1.5 },
      { ...base(), maxRuns: 0 },
      { ...base(), schedule: { kind: "everyN", minutes: 0 } },
      { ...base(), failure: { retries: -1, thenDisable: true } },
      { ...base(), sessions: [{ id: "", cwd: "/tmp" }] },
      { ...base(), sessions: [{ id: "abc" }] },
      { ...base(), color: "chartreuse" },
      { ...base(), tabId: -2 },
    ];
    for (const candidate of invalid) {
      expect(isScheduledTask(candidate)).toBe(false);
    }
  });

  it("tolerates absent optional fields", () => {
    const task = base();
    delete (task as Record<string, unknown>).tabId;
    delete (task as Record<string, unknown>).color;
    delete (task as Record<string, unknown>).lastRunAt;
    delete (task as Record<string, unknown>).nextRunAt;
    expect(isScheduledTask(task)).toBe(true);
  });
});
