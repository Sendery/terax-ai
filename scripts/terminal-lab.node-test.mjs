import assert from "node:assert/strict";
import test from "node:test";
import { attributedProcesses, isIdleSample, parseProcesses, successfulRun } from "./terminal-lab.mjs";

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
