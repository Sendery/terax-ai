import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./cli-entrypoint.mjs";
import { cleanupOwned, observeDescendants, cleanupLabResources } from "./terminal-lab-cleanup.mjs";

export function assessGuiSession(sessions, userId) {
  const unavailable = (reason, details = {}) => ({ available: false, locked: null, ...details, reason });
  if (!Array.isArray(sessions)) return unavailable("Console session list unavailable");
  const console = sessions.filter((s) => s?.onConsole === true);
  if (console.length !== 1) return unavailable("Expected exactly one graphical console session");
  const session = console[0];
  const sameUser = Number.isSafeInteger(session.userId) && session.userId === userId;
  const details = { locked: typeof session.locked === "boolean" ? session.locked : null, sameUser, loginDone: session.loginDone === true };
  if (!sameUser) return unavailable("Graphical session belongs to another user", details);
  if (!details.loginDone) return unavailable("Graphical login is not complete", details);
  if (details.locked === null) return unavailable("Graphical-session lock state unavailable", details);
  if (details.locked) return unavailable("macOS reports the graphical session is locked", details);
  return { available: true, ...details, reason: null };
}

function graphicalSession() {
  const observedAt = new Date().toISOString();
  try {
    const plist = execFileSync("/usr/sbin/ioreg", ["-a", "-l", "-d", "1"], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 });
    const sessions = JSON.parse(execFileSync("python3", [fileURLToPath(new URL("./terminal-lab-session.py", import.meta.url))], { input: plist, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 }));
    return { observedAt, ...assessGuiSession(sessions, process.getuid?.()) };
  } catch (error) {
    return { observedAt, available: false, locked: null, reason: `Unable to inspect graphical session: ${String(error).slice(0, 1024)}` };
  }
}

export function appendRunnerSample(path, sample) {
  appendFileSync(path, JSON.stringify(sample) + "\n");
}

export function readRunArtifacts(folder) {
  const read = (name) => {
    const path = join(folder, name);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, "utf8")); }
    catch (error) { return { errors: [`Invalid ${name}: ${String(error)}`], error: `Invalid ${name}` }; }
  };
  const reportExists = existsSync(join(folder, "report.json"));
  const checkpointExists = existsSync(join(folder, "report.checkpoint.json"));
  const failure = read("report.failure.json");
  const reportSource = reportExists ? "final" : checkpointExists ? "checkpoint" : null;
  let report = reportSource ? read(reportExists ? "report.json" : "report.checkpoint.json") : null;
  if (failure) {
    report = { ...report, errors: [...(Array.isArray(report?.errors) ? report.errors : []), failure.error ?? "Native lab failed"] };
  }
  return { reportExists, reportSource, failure, report };
}

export function parseProcesses(text) {
  return text.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), rssKiB: Number(match[3]), command: match[4] }] : [];
  });
}

export function attributedProcesses(processes, rootPid, baselinePids) {
  const ids = new Set([rootPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of processes) {
      if (ids.has(p.ppid) && !ids.has(p.pid)) { ids.add(p.pid); changed = true; }
    }
  }
  return processes.filter((p) => ids.has(p.pid) || (!baselinePids.has(p.pid) && /com\.apple\.WebKit\.(WebContent|Networking|GPU)(?:$|\b)/.test(p.command)))
    .map((p) => ({ ...p, attribution: ids.has(p.pid) ? "app-or-descendant" : "new-WebKit-helper" }));
}

export function isIdleSample(sample, rootPid) {
  if (sample.status?.status !== "idle-ready" || !sample.processes.some((p) => p.pid === rootPid)) return false;
  const elapsed = Date.parse(sample.at) - Date.parse(sample.status.readyAt);
  return elapsed >= 1000 && elapsed < sample.status.holdMs - 1000;
}

const processes = () => {
  const list = parseProcesses(execFileSync("/bin/ps", ["-axo", "pid=,ppid=,rss=,comm="], { encoding: "utf8" })).filter((p) => p.pid > 0);
  const identities = new Map(JSON.parse(execFileSync("python3", [fileURLToPath(new URL("./terminal-lab-processes.py", import.meta.url))], { input: JSON.stringify(list.map((p) => p.pid)), encoding: "utf8" })).map((p) => [p.pid, p]));
  return list.flatMap((p) => identities.has(p.pid) ? [{ ...p, ...identities.get(p.pid) }] : []);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

function hardware() {
  let apple = {};
  try {
    const info = JSON.parse(execFileSync("/usr/sbin/system_profiler", ["SPHardwareDataType", "SPDisplaysDataType", "-json"], { encoding: "utf8", timeout: 30_000 }));
    const hw = info.SPHardwareDataType?.[0] ?? {};
    apple = { model: hw.machine_model, modelName: hw.machine_name, chip: hw.chip_type, memory: hw.physical_memory, graphics: info.SPDisplaysDataType?.map((gpu) => ({ name: gpu._name, chipset: gpu.sppci_model, vendor: gpu.spdisplays_vendor, metal: gpu.spdisplays_metal, displays: gpu.spdisplays_ndrvs?.map((d) => ({ name: d._name, resolution: d._spdisplays_resolution, refreshRate: d.spdisplays_refresh_rate })) })) };
  } catch (error) { apple = { error: String(error) }; }
  return { platform: platform(), osRelease: release(), architecture: process.arch, cpus: cpus().map((c) => ({ model: c.model, mhz: c.speed })), totalMemoryBytes: totalmem(), apple, runner: process.env.RUNNER_NAME, runnerImage: process.env.ImageOS, runnerImageVersion: process.env.ImageVersion, commit: process.env.GITHUB_SHA, runnerCommit: process.env.TERAX_TERMINAL_LAB_RUNNER_SHA, build: { frontend: "pnpm build (Vite production)", rust: "dev profile, opt-level=3, debug=false, debug-assertions=false", terminalCore: "checksum-pinned prebuilt ReleaseFast, no source fallback", terminalCoreSource: process.env.TERAX_TERMINAL_LAB_CORE_SOURCE, terminalCoreSha256: process.env.TERAX_TERMINAL_LAB_CORE_SHA256, sandboxIdentifier: "app.crynta.terax.sandbox", mainWindowCreated: false } };
}

export async function run(binary, output, mode, repetition, timeoutMs) {
  const folder = join(output, `${mode}-${repetition}`);
  mkdirSync(folder, { recursive: true });
  const home = join(folder, "home");
  const cwd = join(home, "shell-session");
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "README.txt"), "Disposable Terminal Lab shell fixture.\n");
  writeFileSync(join(cwd, "src", "example.txt"), "No user files or credentials.\n");
  writeFileSync(join(home, ".bashrc"), "export PS1='lab$ '\n");
  const reportPath = join(folder, "report.json");
  let guiSession = graphicalSession();
  if (!guiSession.available) {
    const result = { mode, repetition, pid: null, preflightFailed: true, guiSession, failureReason: guiSession.reason, reportExists: false, report: null, outcome: null, timedOut: false, cleanup: { initial: [], sent: [], errors: [], survivors: [] }, samples: [] };
    json(join(folder, "runner.json"), result);
    return result;
  }
  const baseline = processes();
  if (!baseline.some((p) => p.pid === process.pid && p.birth)) throw new Error("Kernel process birth identity unavailable; no sandbox was launched");
  const baselinePids = new Set(baseline.map((p) => p.pid));
  json(join(folder, "baseline-processes.json"), baseline.filter((p) => /com\.apple\.WebKit\./.test(p.command)));
  const log = createWriteStream(join(folder, "app.log"));
  const child = spawn(binary, [cwd], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home, SHELL: "/bin/bash", LC_ALL: "en_US.UTF-8", TERAX_TERMINAL_LAB_AUTORUN: reportPath, TERAX_TERMINAL_LAB_MODE: mode, TERAX_TERMINAL_LAB_IDLE_COUNT: "12", TERAX_TERMINAL_LAB_HOLD_SECONDS: "30" } });
  const powerAssertion = { command: "/usr/bin/caffeinate", args: ["-d", "-i", "-t", String(Math.ceil(timeoutMs / 1000) + 30), "-w", String(child.pid)], pid: null, error: null, outcome: null };
  const power = child.pid ? spawn(powerAssertion.command, powerAssertion.args, { stdio: "ignore" }) : null;
  let powerExited = power === null;
  if (power) {
    powerAssertion.pid = power.pid;
    power.once("error", (error) => { powerExited = true; powerAssertion.error = String(error); });
    power.once("close", (code, signal) => { powerExited = true; powerAssertion.outcome = { code, signal }; });
  }
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let exited = false;
  let outcome = null;
  const completion = new Promise((resolveExit) => {
    child.once("error", (error) => { exited = true; outcome = { error: String(error) }; resolveExit(); });
    child.once("close", (code, signal) => { exited = true; outcome ??= { code, signal }; resolveExit(); });
  });
  const samples = [];
  const started = Date.now();
  let timedOut = false;
  let timeoutReason = null;
  let failureReason = null;
  let lastStatus = null;
  let lastProgress = started;
  const owned = new Map();
  const powerOwned = new Map();
  const observePower = (all) => {
    if (!power?.pid || powerOwned.size) return;
    const identity = all.find((p) => p.pid === power.pid && p.ppid === process.pid && Number(p.birth.split(":")[0]) * 1000 >= started - 1000);
    if (identity) powerOwned.set(identity.pid, identity);
  };
  let lastGuiCheck = 0;
  let cleanup = { initial: [], sent: [], errors: [], survivors: [] };
  try {
    while (!exited) {
      let status = null;
      const statusPath = join(folder, "report.status.json");
      if (existsSync(statusPath)) {
        try { status = JSON.parse(readFileSync(statusPath, "utf8")); } catch { /* Atomic replacement may race process exit. */ }
      }
      const all = processes();
      observePower(all);
      if (Date.now() - lastGuiCheck >= 5000) {
        guiSession = graphicalSession();
        lastGuiCheck = Date.now();
      }
      if (!owned.size && child.exitCode === null) {
        const root = all.find((p) => p.pid === child.pid && Number(p.birth.split(":")[0]) * 1000 >= started - 1000);
        if (root) owned.set(root.pid, root);
      }
      observeDescendants(all, owned);
      const attributed = attributedProcesses(all, child.pid, baselinePids);
      const sample = { at: new Date().toISOString(), elapsedMs: Date.now() - started, status, guiSession, rssKiB: attributed.reduce((sum, p) => sum + p.rssKiB, 0), processes: attributed };
      samples.push(sample);
      appendRunnerSample(join(folder, "runner.samples.jsonl"), sample);
      if (!guiSession.available) { failureReason = guiSession.reason; break; }
      if (status?.status === "failed" || existsSync(join(folder, "report.failure.json"))) {
        failureReason = status?.error ?? "Native lab failed; see report.failure.json";
        break;
      }
      const statusKey = JSON.stringify(status);
      if (statusKey !== lastStatus) { lastStatus = statusKey; lastProgress = Date.now(); }
      if (!status && Date.now() - started > 90_000) timeoutReason = "No webview startup status within 90 seconds";
      if (status && Date.now() - lastProgress > 5 * 60_000) timeoutReason = "Lab step made no progress for five minutes";
      if (Date.now() - started > timeoutMs) timeoutReason = "Run exceeded its wall-clock limit";
      if (timeoutReason) { timedOut = true; break; }
      await sleep(1000);
    }
  } finally {
    cleanup = await cleanupLabResources([
      { name: "App", run: () => cleanupOwned(owned, { snapshot: processes, signal: (pid, signal) => process.kill(pid, signal), sleep }) },
      { name: "Awake assertion identity lookup", run: () => observePower(processes()) },
      { name: "Awake assertion", run: () => cleanupOwned(powerOwned, { snapshot: processes, signal: (pid, signal) => process.kill(pid, signal), sleep }) },
    ]);
    if (!owned.size && !exited) cleanup.errors.push({ error: "App birth identity unavailable; refusing unverified signals" });
    if (power && !powerExited && !powerOwned.size) cleanup.errors.push({ error: "Awake assertion birth identity unavailable; refusing unverified signals" });
    await Promise.race([completion, sleep(1000)]);
    child.stdout.unpipe(log);
    child.stderr.unpipe(log);
    if (cleanup.errors.length || cleanup.survivors.length) {
      child.unref();
      power?.unref();
      child.stdout.destroy();
      child.stderr.destroy();
    }
    log.end();
    rmSync(join(folder, "report.payload.bin"), { force: true });
  }
  guiSession = graphicalSession();
  if (!guiSession.available) failureReason ??= guiSession.reason;
  const idle = samples.filter((sample) => isIdleSample(sample, child.pid));
  const rss = idle.map((sample) => sample.rssKiB).sort((a, b) => a - b);
  const result = { mode, repetition, pid: child.pid, guiSession, powerAssertion, elapsedMs: Date.now() - started, timedOut, timeoutReason, failureReason, outcome, cleanup, ...readRunArtifacts(folder), rssMethod: "ps RSS KiB sum of app descendants and new named WebKit helpers. Shared pages can be counted more than once; no PSS claim. Pre-existing WebKit helpers are excluded and listed in the baseline.", idleSamples: idle.length, idleRssKiB: rss.length ? { min: rss[0], median: rss[Math.floor(rss.length / 2)], max: rss.at(-1) } : null, samples };
  const { report: _report, ...runner } = result;
  json(join(folder, "runner.json"), runner);
  return result;
}

export function selectedModes(value) {
  if (value === undefined) return ["bench", "idle-engine"];
  const modes = value.split(",");
  if (new Set(modes).size !== modes.length || modes.some((mode) => !["bench", "gate-engine", "gate-engine-profile", "gate-engine-batched", "gate-engine-profile-batched", "idle-engine"].includes(mode)))
    throw new Error("Invalid lab modes: use bench, gate-engine, gate-engine-profile, gate-engine-batched, gate-engine-profile-batched or idle-engine without duplicates");
  return modes;
}

async function main() {
  const [binaryArg, outputArg, modesArg] = process.argv.slice(2);
  const modes = selectedModes(modesArg);
  if (!binaryArg || !outputArg || platform() !== "darwin") throw new Error("Usage on a clean hosted macOS runner: node scripts/terminal-lab.mjs <sandbox-binary> <output-dir> [modes]");
  const binary = resolve(binaryArg);
  const output = resolve(outputArg);
  if (!existsSync(binary)) throw new Error(`Missing sandbox binary: ${binary}`);
  mkdirSync(output, { recursive: true });
  json(join(output, "hardware.json"), hardware());
  const runs = [];
  repetitions: for (const repetition of [1, 2]) {
    for (const mode of modes) {
      const result = await run(binary, output, mode, repetition, mode === "bench" || mode === "gate-engine" || mode === "gate-engine-profile" || mode === "gate-engine-batched" || mode === "gate-engine-profile-batched" ? 42 * 60_000 : 3 * 60_000);
      runs.push(result);
      if (result.failure || result.failureReason || result.cleanup.errors.length || result.cleanup.survivors.length) break repetitions;
    }
  }
  json(join(output, "summary.json"), runs.map(({ samples, report, ...run }) => ({ ...run, errors: report?.errors ?? ["No webview report: GUI launch or rendering did not finish"], engineBenchRuns: report?.bench?.length ?? 0, captures: report?.captures ?? null })));
  if (runs.some((run) => !successfulRun(run))) process.exitCode = 1;
}

export function successfulRun(run) {
  const report = run.report;
  if (run.preflightFailed || run.guiSession?.available === false || run.samples?.some((sample) => sample.guiSession?.available === false) || run.failure || run.failureReason || run.timedOut || !run.reportExists || run.outcome?.code !== 0 || run.cleanup?.errors?.length || run.cleanup?.survivors?.length || !Array.isArray(report?.errors) || report.errors.length) return false;
  if (["gate-engine", "gate-engine-profile", "gate-engine-batched", "gate-engine-profile-batched"].includes(run.mode)) {
    const bench = report.bench;
    return bench?.length === 3 && ["ascii", "sgr", "tui"].every((kind) => bench.filter((b) => b.kind === kind).length === 1) && bench.every((b) =>
      (!["gate-engine-profile", "gate-engine-profile-batched"].includes(run.mode) || (b.profile?.complete === true && b.profile.frames?.length === b.frames && b.profile.draws?.length > 0)) && (!["gate-engine-batched", "gate-engine-profile-batched"].includes(run.mode) || (b.creditBatch?.mode === "window-microtask" && b.creditBatch.complete === true && b.creditBatch.queued === b.frames && b.creditBatch.registered === b.frames && b.creditBatch.failed === 0 && b.creditBatch.rejected === 0 && b.creditBatch.pending === 0 && b.creditBatch.invocations > 0 && b.creditBatch.invocations <= b.frames)) && b.sessions === 12 && b.megabytesPerSession === 1024 && !b.error && !b.timedOut && b.contextLosses === 0 && b.concurrent?.evaluable === true && b.completeness?.length === 12 && b.completeness.every((c) => c.complete === true) && b.rust?.length === 12 && b.rust.every((stats) => stats !== null));
  }
  if (run.mode !== "bench") return run.idleSamples >= 10 && report.idle?.scrollbackVerified === true && report.idle.measuredScrollbackRows?.length === 12 && report.idle.measuredScrollbackRows.every((rows) => rows === 10_000);
  const echo = report.echo?.engine;
  return report.bench?.length === 6 && report.captures?.engine === true && echo?.count === 50 && echo.samples?.length === 50 && echo.timeouts === 0 && !echo.error;
}

if (isMainModule(import.meta.url)) await main();
