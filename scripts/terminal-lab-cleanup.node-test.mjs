import assert from "node:assert/strict";
import test from "node:test";
import { cleanupOwned, observeDescendants, sameProcess } from "./terminal-lab-cleanup.mjs";

const root = { pid: 10, ppid: 1, pgid: 10, birth: "100:123", command: "/tmp/terax" };
const shell = { pid: 11, ppid: 10, pgid: 11, birth: "101:456", command: "/bin/bash" };

test("process identity uses kernel birth microseconds, not reused PID or executable name", () => {
  assert.equal(sameProcess(shell, { ...shell, command: "/bin/cat" }), true);
  assert.equal(sameProcess(shell, { ...shell, birth: "101:457" }), false);
  assert.equal(sameProcess(shell, { ...shell, birth: undefined }), false);
});

test("cleanup escalates a resistant orphaned PTY process without signalling unrelated processes", async () => {
  const owned = new Map([[root.pid, root]]);
  observeDescendants([root, shell], owned);
  let all = [{ ...shell, ppid: 1 }, { ...shell, pid: 40, ppid: 1, birth: "103:1" }];
  let now = 0;
  const signals = [];
  const result = await cleanupOwned(owned, {
    snapshot: () => all,
    signal: (pid, kind) => { signals.push([pid, kind]); if (kind === "SIGKILL") all = all.filter((p) => p.pid !== pid); },
    sleep: async (ms) => { now += ms; }, now: () => now,
  }, 200, 200);
  assert.deepEqual(signals, [[11, "SIGTERM"], [11, "SIGKILL"]]);
  assert.deepEqual(result.survivors, []);
  assert.deepEqual(all.map((p) => p.pid), [40]);
});

test("PID reuse between discovery and signal is checked again and never signalled", async () => {
  let calls = 0;
  let now = 0;
  const signals = [];
  const result = await cleanupOwned(new Map([[shell.pid, shell]]), {
    snapshot: () => [++calls === 1 ? shell : { ...shell, birth: "102:456" }],
    signal: (...args) => signals.push(args), sleep: async (ms) => { now += ms; }, now: () => now,
  }, 100, 100);
  assert.deepEqual(signals, []);
  assert.deepEqual(result.survivors, []);
});

test("bounded cleanup reports surviving identities and signal errors", async () => {
  let now = 0;
  const result = await cleanupOwned(new Map([[shell.pid, shell]]), {
    snapshot: () => [shell], signal: () => { throw Object.assign(new Error("not allowed"), { code: "EPERM" }); },
    sleep: async (ms) => { now += ms; }, now: () => now,
  }, 100, 100);
  assert.equal(result.errors.length, 2);
  assert.equal(result.survivors[0].birth, shell.birth);
});
