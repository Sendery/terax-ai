import { describe, expect, it } from "vitest";
import { isRunning, pickJob } from "./jobs";
import type { TtsJob } from "./native";

function job(over: Partial<TtsJob> = {}): TtsJob {
  return {
    id: 1,
    kind: "engine-install",
    engine: "chatterbox",
    model: null,
    state: "running",
    startedAtMs: 100,
    exitCode: null,
    ...over,
  };
}

describe("pickJob", () => {
  it("has nothing to say when no job matches", () => {
    expect(pickJob([], () => true)).toBeNull();
    expect(
      pickJob([job({ engine: "kokoro" })], (j) => j.engine === "chatterbox"),
    ).toBeNull();
  });

  it("prefers the running job over a more recent finished one", () => {
    const running = job({ id: 1, startedAtMs: 100 });
    const finished = job({ id: 2, startedAtMs: 900, state: "failed" });
    expect(pickJob([running, finished], () => true)).toBe(running);
  });

  it("falls back to the latest finished job so its log stays readable", () => {
    const old = job({ id: 1, startedAtMs: 100, state: "done" });
    const recent = job({ id: 2, startedAtMs: 900, state: "failed" });
    expect(pickJob([old, recent], () => true)).toBe(recent);
  });
});

describe("isRunning", () => {
  it("is true only while the job runs", () => {
    expect(isRunning(job({ state: "running" }))).toBe(true);
    for (const state of ["done", "failed", "cancelled"] as const) {
      expect(isRunning(job({ state }))).toBe(false);
    }
    expect(isRunning(null)).toBe(false);
  });

  it("lets a card recover after a failed install", () => {
    // The regression: a failed install stayed selected by pickJob, and treating
    // any selected job as busy left Install spinning and disabled forever.
    const failed = pickJob([job({ state: "failed", exitCode: 1 })], () => true);
    expect(failed).not.toBeNull();
    expect(isRunning(failed)).toBe(false);
  });
});
