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

test("app cleanup failure does not skip awake-assertion cleanup",async()=>{
 const {cleanupLabResources}=await import("./terminal-lab-cleanup.mjs");const steps=[];
 const r=await cleanupLabResources([
  {name:"app",run:async()=>{steps.push("app");throw new Error("snapshot failed");}},
  {name:"power lookup",run:async()=>{steps.push("lookup");}},
  {name:"power",run:async()=>{steps.push("power");return{initial:[root],sent:[{pid:10}],errors:[],survivors:[]};}},
 ]);
 assert.deepEqual(steps,["app","lookup","power"]);assert.equal(r.errors.length,1);assert.match(r.errors[0].error,/app.*snapshot failed/);assert.equal(r.sent.length,1);
});
test("independent cleanup failures are all retained and cannot prevent later steps",async()=>{
 const {cleanupLabResources}=await import("./terminal-lab-cleanup.mjs");let last=false;
 const r=await cleanupLabResources([
  {name:"app",run:async()=>{throw new Error("app failure");}},
  {name:"power lookup",run:async()=>{throw new Error("lookup failure");}},
  {name:"power",run:async()=>{last=true;throw new Error("power failure");}},
 ]);assert.equal(last,true);assert.equal(r.errors.length,3);assert.equal(r.survivors.length,0);
});
