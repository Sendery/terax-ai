import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attributedProcesses, isIdleSample, parseProcesses, successfulRun, appendRunnerSample, readRunArtifacts } from "./terminal-lab.mjs";

test("RSS names exact processes, includes descendants and new WebKit, excludes baseline helpers", () => {
  const all = parseProcesses(" 10 1 200 /tmp/terax\n11 10 30 /bin/bash\n12 11 10 /bin/cat\n20 1 300 /System/com.apple.WebKit.WebContent\n21 1 50 /System/com.apple.WebKit.GPU\n30 1 80 /bin/other\n");
  const attributed = attributedProcesses(all, 10, new Set([21, 30]));
  assert.deepEqual(attributed.map((p) => p.pid), [10, 11, 12, 20]);
  assert.equal(attributed.reduce((sum, p) => sum + p.rssKiB, 0), 540);
  assert.equal(attributed.at(-1).attribution, "new-WebKit-helper");
});

test("process parser ignores malformed records and preserves executable names with spaces", () => {
  assert.deepEqual(parseProcesses("invalid\n4 1 30 /Applications/Pi-Terax Sandbox/terax\n"), [{ pid: 4, ppid: 1, rssKiB: 30, command: "/Applications/Pi-Terax Sandbox/terax" }]);
});

test("idle RSS excludes startup, teardown and an exited app", () => {
  const sample = { status: { status: "idle-ready", readyAt: "2026-11-10T12:00:00Z", holdMs: 30_000 }, at: "2026-11-10T12:00:05Z", processes: [{ pid: 10 }] };
  assert.equal(isIdleSample(sample, 10), true);
  assert.equal(isIdleSample({ ...sample, at: "2026-11-10T12:00:00Z" }, 10), false);
  assert.equal(isIdleSample({ ...sample, at: "2026-11-10T12:00:29Z" }, 10), false);
  assert.equal(isIdleSample({ ...sample, processes: [] }, 10), false);
});

test("successful runs require both complete echo measurements and successful cleanup", () => {
  const echo = { count: 50, samples: Array(50).fill(1), timeouts: 0 };
  const run = { mode: "bench", timedOut: false, reportExists: true, outcome: { code: 0 }, cleanup: { errors: [], survivors: [] }, report: { errors: [], bench: Array(6).fill({}), xtermBench: Array(6).fill({}), captures: { engine: true, xterm: true }, echo: { engine: echo, xterm: echo } } };
  assert.equal(successfulRun(run), true);
  assert.equal(successfulRun({ ...run, report: { ...run.report, echo: { engine: { count: 0, samples: [], timeouts: 50 }, xterm: echo } } }), false);
  assert.equal(successfulRun({ ...run, report: {} }), false);
  assert.equal(successfulRun({ ...run, cleanup: { errors: [], survivors: [{ pid: 1 }] } }), false);
});


test("runner persists each sample before a native or runner crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "terax-lab-samples-"));
  try {
    const path = join(dir, "runner.samples.jsonl");
    appendRunnerSample(path, { at: "first", rssKiB: 100 });
    appendRunnerSample(path, { at: "second", rssKiB: 200 });
    assert.deepEqual(readFileSync(path, "utf8").trim().split("\n").map(JSON.parse), [
      { at: "first", rssKiB: 100 }, { at: "second", rssKiB: 200 },
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("native failure retains partial measurements and can never pass as a final report", () => {
  const dir = mkdtempSync(join(tmpdir(), "terax-lab-checkpoint-"));
  try {
    const checkpoint = { bench: [{ frames: 123 }], errors: [] };
    writeFileSync(join(dir, "report.checkpoint.json"), JSON.stringify(checkpoint));
    writeFileSync(join(dir, "report.failure.json"), JSON.stringify({ status: "failed", reason: "webview-restarted", error: "WebContent restarted" }));
    const result = readRunArtifacts(dir);
    assert.equal(result.reportExists, false);
    assert.equal(result.reportSource, "checkpoint");
    assert.equal(result.failure.reason, "webview-restarted");
    assert.deepEqual(result.report.bench, checkpoint.bench);
    assert.deepEqual(result.report.errors, ["WebContent restarted"]);
    assert.equal(successfulRun({ ...result, outcome: { code: 0 }, cleanup: {} }), false);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "report.checkpoint.json"), "utf8")), checkpoint);
    writeFileSync(join(dir, "report.json"), JSON.stringify({ errors: [], bench: ["final"] }));
    assert.deepEqual(readRunArtifacts(dir).report.bench, ["final"]);
    assert.deepEqual(readRunArtifacts(dir).report.errors, ["WebContent restarted"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("explicit lab mode selection is closed and cannot reduce a gate workload", async () => {
  const { selectedModes } = await import("./terminal-lab.mjs");
  assert.deepEqual(selectedModes(), ["bench", "idle-engine", "idle-xterm"]);
  assert.deepEqual(selectedModes("gate-engine"), ["gate-engine"]);
  assert.deepEqual(selectedModes("idle-engine,idle-xterm"), ["idle-engine", "idle-xterm"]);
  for (const value of ["", "other", "bench,bench", "gate-engine,", "gate-engine:1"])
    assert.throws(() => selectedModes(value));
});
test("gate collection requires three clean sustained twelve-pane runs, not a target FPS", () => {
  const b = (kind) => ({ kind, sessions: 12, megabytesPerSession: 1024, rust: Array(12).fill({}), concurrent: { evaluable: true, minFramesPerSecond: 30 }, completeness: Array(12).fill({ complete: true }), contextLosses: 0 });
  const run = { mode: "gate-engine", reportExists: true, outcome: { code: 0 }, cleanup: {}, report: { errors: [], bench: [b("ascii"), b("sgr"), b("tui")] } };
  assert.equal(successfulRun(run), true);
  for (const change of [{ timedOut: true }, { error: "bad draw" }, { contextLosses: 1 }, { concurrent: { evaluable: false } }, { completeness: [] }, { sessions: 1 }, { megabytesPerSession: 32 }]) {
    assert.equal(successfulRun({ ...run, report: { ...run.report, bench: [{ ...b("ascii"), ...change }, b("sgr"), b("tui")] } }), false);
  }
});
