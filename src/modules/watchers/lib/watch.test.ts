import { describe, expect, it } from "vitest";
import {
  applyRun,
  createWatch,
  earliestDue,
  nextDueAt,
  parseWatchMessage,
  patchWatch,
  summarizeWatch,
  WATCH_OUTPUT_MAX_CHARS,
  watchAgentMessage,
  watchNotification,
  type WatchRunResult,
} from "./watch";

const ok = (stdout: string, exitCode: number | null = 0): WatchRunResult => ({
  ok: true,
  stdout,
  stderr: "",
  exitCode,
  timedOut: false,
});

function watch() {
  return createWatch(
    { name: " pr 42 ", command: " gh pr view 42 ", intervalSeconds: 60 },
    "w-1",
    1000,
  );
}

describe("watch", () => {
  it("starts enabled, trimmed, notifying, and due at once", () => {
    const w = watch();
    expect(w).toMatchObject({
      name: "pr 42",
      command: "gh pr view 42",
      enabled: true,
      onChange: "notify",
      cwd: null,
    });
    expect(nextDueAt(w)).toBe(1000);
  });

  // The first run has nothing to compare against: reporting it would notify
  // the user about every watch they create.
  it("records a baseline on the first run without calling it a change", () => {
    const first = applyRun(watch(), ok("OPEN"), 2000);
    expect(first.changed).toBe(false);
    expect(first.watch).toMatchObject({ runCount: 1, changeCount: 0, lastOutput: "OPEN" });
    expect(nextDueAt(first.watch)).toBe(62_000);
  });

  it("reports a change only when the output or exit code differs", () => {
    const base = applyRun(watch(), ok("OPEN"), 2000).watch;
    expect(applyRun(base, ok("OPEN\n"), 3000).changed).toBe(false);
    const merged = applyRun(base, ok("MERGED"), 3000);
    expect(merged.changed).toBe(true);
    expect(merged.watch).toMatchObject({ changeCount: 1, lastChangeAt: 3000 });
    expect(applyRun(base, ok("OPEN", 1), 3000).changed).toBe(true);
  });

  it("never treats a failed or timed-out run as news, and keeps the baseline", () => {
    const base = applyRun(watch(), ok("OPEN"), 2000).watch;
    const failed = applyRun(base, { ok: false, error: "spawn failed" }, 3000);
    expect(failed.changed).toBe(false);
    expect(failed.watch).toMatchObject({ lastError: "spawn failed", lastOutput: "OPEN" });
    const slow = applyRun(base, { ...ok("partial"), timedOut: true } as WatchRunResult, 3000);
    expect(slow.changed).toBe(false);
    expect(slow.watch.lastDigest).toBe(base.lastDigest);
    const recovered = applyRun(failed.watch, ok("OPEN"), 4000);
    expect(recovered.changed).toBe(false);
    expect(recovered.watch.lastError).toBeUndefined();
  });

  it("stores output redacted and bounded", () => {
    const secret = applyRun(watch(), ok("API_KEY=abc123secretvalue"), 2000).watch;
    expect(secret.lastOutput).not.toContain("abc123secretvalue");
    const big = applyRun(watch(), ok("x".repeat(WATCH_OUTPUT_MAX_CHARS + 50)), 2000).watch;
    expect(big.lastOutput?.endsWith("[truncated]")).toBe(true);
  });

  it("drops the baseline when the command or directory changes", () => {
    const base = applyRun(watch(), ok("OPEN"), 2000).watch;
    expect(patchWatch(base, { intervalSeconds: 120 }).lastDigest).toBe(base.lastDigest);
    expect(patchWatch(base, { command: "gh pr view 43" }).lastDigest).toBeUndefined();
    expect(patchWatch(base, { cwd: "/other" }).lastOutput).toBeUndefined();
    expect(patchWatch({ ...base, prompt: "x" }, { prompt: " " }).prompt).toBeUndefined();
  });

  it("schedules from enabled watches only", () => {
    const a = { ...watch(), id: "a", lastRunAt: 5000 };
    const b = { ...watch(), id: "b", lastRunAt: 1000, enabled: false };
    expect(earliestDue([a, b])).toBe(65_000);
    expect(earliestDue([b])).toBeNull();
  });

  it("summarizes without the stored output", () => {
    const base = applyRun(watch(), ok("OPEN"), 2000).watch;
    const summary = summarizeWatch(base, true);
    expect(summary).not.toHaveProperty("lastOutput");
    expect(summary).not.toHaveProperty("lastDigest");
    expect(summary).toMatchObject({ running: true, nextRunAt: 62_000 });
    expect(summarizeWatch({ ...base, enabled: false }, false).nextRunAt).toBeNull();
  });

  it("round-trips the message it hands to the agent", () => {
    const base = applyRun(
      { ...watch(), name: 'the "radar"', prompt: "Update graph pr-radar." },
      ok("MERGED"),
      2000,
    ).watch;
    const message = watchAgentMessage(base);
    expect(message).toContain("$ gh pr view 42\nMERGED");
    expect(parseWatchMessage(message)).toEqual({
      name: "the 'radar'",
      rest: "Update graph pr-radar.",
    });
    expect(parseWatchMessage("plain text")).toBeNull();
  });

  it("notifies with the first meaningful line", () => {
    const base = applyRun(watch(), ok("\n\n  MERGED by ana  \nmore"), 2000).watch;
    expect(watchNotification(base)).toEqual({ title: "Watch: pr 42", body: "MERGED by ana" });
  });
});
