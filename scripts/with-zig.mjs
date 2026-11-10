#!/usr/bin/env node
/**
 * Run a command with the Zig that the `ghostty-engine` cargo feature needs.
 *
 *   node scripts/with-zig.mjs -- cargo test --features ghostty-engine
 *
 * Provisions Zig 0.15.2 for this host under `src-tauri/target/toolchains/`
 * (checksum pinned, extracted once, reused by every later run), puts it first
 * on PATH and sets LIBGHOSTTY_VT_SYS_OPTIMIZE=ReleaseFast unless the caller
 * set it, so a debug build of the app still links an optimized terminal core.
 *
 * Zig 0.15.2 cannot read the libSystem.tbd of the macOS 26 and later SDKs, so
 * every native link fails there. On macOS a one-off probe decides whether the
 * host links natively; when it does not, Zig runs through a wrapper that shows
 * it a stand-in SDK made of Zig's own bundled libc files. Only the Zig process
 * sees that SDK: rustc and the C compilers of other crates keep the real one.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { release } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ZIG_VERSION = "0.15.2";

// From https://ziglang.org/download/index.json. A mismatch is a hard failure.
const ZIG_SHA256 = {
  "aarch64-macos": "3cc2bab367e185cdfb27501c4b30b1b0653c28d9f73df8dc91488e66ece5fa6b",
  "x86_64-macos": "375b6909fc1495d16fc2c7db9538f707456bfc3373b14ee83fdd3e22b3d43f7f",
  "aarch64-linux": "958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f",
  "x86_64-linux": "02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239",
  "aarch64-windows": "b926465f8872bf983422257cd9ec248bb2b270996fbe8d57872cca13b56fc370",
  "x86_64-windows": "3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c",
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOLCHAINS = join(ROOT, "src-tauri", "target", "toolchains");

class SetupError extends Error {}

// Thrown rather than exiting so `finally` blocks clean up partial downloads.
function fail(message) {
  throw new SetupError(message);
}

function log(message) {
  process.stderr.write(`with-zig: ${message}\n`);
}

export function hostTriple(platform = process.platform, arch = process.arch) {
  const os = { darwin: "macos", linux: "linux", win32: "windows" }[platform];
  const cpu = { arm64: "aarch64", x64: "x86_64" }[arch];
  if (!os || !cpu) return null;
  return `${cpu}-${os}`;
}

export function splitCommand(argv) {
  const at = argv.indexOf("--");
  if (at === -1) return null;
  const command = argv.slice(at + 1);
  return command.length > 0 ? command : null;
}

function archiveName(triple) {
  const ext = triple.endsWith("-windows") ? "zip" : "tar.xz";
  return `zig-${triple}-${ZIG_VERSION}.${ext}`;
}

function zigDirName(triple) {
  return `zig-${triple}-${ZIG_VERSION}`;
}

function zigExeIn(dir, triple) {
  return join(dir, triple.endsWith("-windows") ? "zig.exe" : "zig");
}

function zigExe(triple) {
  return zigExeIn(join(TOOLCHAINS, zigDirName(triple)), triple);
}

function tmpName(base) {
  return `${base}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
}

// A concurrent run may have published the same directory first; theirs wins.
function publishDir(tmp, final) {
  try {
    renameSync(tmp, final);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    if (!existsSync(final)) throw err;
  }
}

async function download(url, dest, expectedSha) {
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    fail(
      `could not download ${url} (${err.cause?.code ?? err.message}). ` +
        `The ghostty-engine feature needs Zig ${ZIG_VERSION}; connect to the network and retry.`,
    );
  }
  if (!response.ok || !response.body) {
    fail(`could not download ${url}: HTTP ${response.status}`);
  }
  const hash = createHash("sha256");
  const body = Readable.fromWeb(response.body);
  body.on("data", (chunk) => hash.update(chunk));
  await pipeline(body, createWriteStream(dest));
  const actual = hash.digest("hex");
  if (actual !== expectedSha) {
    rmSync(dest, { force: true });
    fail(`checksum mismatch for ${url}: expected ${expectedSha}, got ${actual}`);
  }
}

function zigRuns(exe) {
  const out = spawnSync(exe, ["version"], { encoding: "utf8" });
  return out.status === 0 && out.stdout.trim() === ZIG_VERSION;
}

async function ensureZig(triple) {
  const exe = zigExe(triple);
  if (existsSync(exe)) return exe;

  mkdirSync(TOOLCHAINS, { recursive: true });
  const name = archiveName(triple);
  const url = `https://ziglang.org/download/${ZIG_VERSION}/${name}`;
  const archive = join(TOOLCHAINS, tmpName(name));
  const staging = join(TOOLCHAINS, tmpName("extract"));
  log(`downloading Zig ${ZIG_VERSION} for ${triple}`);
  try {
    await download(url, archive, ZIG_SHA256[triple]);
    mkdirSync(staging);
    // -m: fresh mtimes, so cleaners that prune by age never eat the toolchain.
    const tar = spawnSync("tar", ["-xmf", archive, "-C", staging], { stdio: "inherit" });
    if (tar.status !== 0) fail(`could not extract ${name}`);
    const extracted = join(staging, zigDirName(triple));
    if (!existsSync(extracted)) fail(`${name} did not contain ${zigDirName(triple)}`);
    if (!zigRuns(zigExeIn(extracted, triple))) {
      fail(`the downloaded Zig does not run or is not ${ZIG_VERSION}`);
    }
    publishDir(extracted, join(TOOLCHAINS, zigDirName(triple)));
  } finally {
    rmSync(archive, { force: true });
    rmSync(staging, { recursive: true, force: true });
  }
  return exe;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

// The stand-in SDK and the wrapper that shows it only to Zig.
function ensureMacShim(zig, triple) {
  const shimRoot = join(TOOLCHAINS, `zig-macos-shim-${triple}-${ZIG_VERSION}`);
  const wrapperDir = join(shimRoot, "bin");
  if (existsSync(join(wrapperDir, "zig"))) return wrapperDir;

  const zigLib = join(dirname(zig), "lib", "libc");
  const staging = join(TOOLCHAINS, tmpName("shim"));
  const sdk = join(shimRoot, "MacOSX.sdk");
  const stagedSdk = join(staging, "MacOSX.sdk");
  mkdirSync(join(stagedSdk, "usr", "lib"), { recursive: true });
  mkdirSync(join(stagedSdk, "System", "Library", "Frameworks"), { recursive: true });
  cpSync(join(zigLib, "darwin", "libSystem.tbd"), join(stagedSdk, "usr", "lib", "libSystem.tbd"));
  cpSync(join(zigLib, "darwin", "SDKSettings.json"), join(stagedSdk, "SDKSettings.json"));
  cpSync(join(zigLib, "include", "any-macos-any"), join(stagedSdk, "usr", "include"), {
    recursive: true,
  });

  mkdirSync(join(staging, "xcrun"));
  writeExecutable(
    join(staging, "xcrun", "xcrun"),
    [
      "#!/bin/sh",
      'for a in "$@"; do',
      `  if [ "$a" = "--show-sdk-path" ]; then echo ${shellQuote(sdk)}; exit 0; fi`,
      "done",
      'exec /usr/bin/xcrun "$@"',
      "",
    ].join("\n"),
  );
  mkdirSync(join(staging, "bin"));
  writeExecutable(
    join(staging, "bin", "zig"),
    [
      "#!/bin/sh",
      `PATH=${shellQuote(join(shimRoot, "xcrun"))}:"$PATH" exec ${shellQuote(zig)} "$@"`,
      "",
    ].join("\n"),
  );
  publishDir(staging, shimRoot);
  return wrapperDir;
}

function linkProbe(zig, pathPrefix) {
  const dir = join(TOOLCHAINS, tmpName("probe"));
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "probe.zig"), "pub fn main() void {}\n");
    const env = { ...process.env, PATH: `${pathPrefix}${delimiter}${process.env.PATH ?? ""}` };
    const out = spawnSync(
      zig,
      [
        "build-exe",
        "probe.zig",
        "--cache-dir",
        join(dir, "cache"),
        "--global-cache-dir",
        join(dir, "global-cache"),
      ],
      { cwd: dir, env, encoding: "utf8" },
    );
    if (out.status !== 0) return false;
    return spawnSync(join(dir, "probe"), []).status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Returns the directory to put first on PATH. The verdict is cached per macOS
// release so an OS upgrade probes again.
function macPathDir(zig, triple) {
  const statePath = join(TOOLCHAINS, `zig-${triple}-${ZIG_VERSION}.link.json`);
  const osRelease = release();
  let state = null;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    state = null;
  }
  if (state?.osRelease !== osRelease) {
    log(`checking whether Zig links natively on this macOS (${osRelease})`);
    let native = linkProbe(zig, dirname(zig));
    if (!native) {
      const wrapperDir = ensureMacShim(zig, triple);
      if (!linkProbe(join(wrapperDir, "zig"), wrapperDir)) {
        fail("Zig cannot link on this macOS, not even through the stand-in SDK");
      }
      log("native linking fails; using the stand-in SDK for Zig only");
    }
    state = { osRelease, native };
    writeFileSync(statePath, `${JSON.stringify(state)}\n`);
  }
  return state.native ? dirname(zig) : ensureMacShim(zig, triple);
}

function pathKey(env) {
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

async function main() {
  const command = splitCommand(process.argv.slice(2));
  if (!command) fail("usage: node scripts/with-zig.mjs -- <command> [args...]");

  const triple = hostTriple();
  if (!triple || !ZIG_SHA256[triple]) {
    fail(`no pinned Zig ${ZIG_VERSION} download for ${process.platform}/${process.arch}`);
  }

  const zig = await ensureZig(triple);
  const binDir = triple.endsWith("-macos") ? macPathDir(zig, triple) : dirname(zig);

  const env = { ...process.env };
  const key = pathKey(env);
  env[key] = `${binDir}${delimiter}${env[key] ?? ""}`;
  env.LIBGHOSTTY_VT_SYS_OPTIMIZE ??= "ReleaseFast";

  const child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (err) => {
    process.stderr.write(`with-zig: could not run ${command[0]}: ${err.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 1);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`with-zig: ${err instanceof SetupError ? err.message : err.stack}\n`);
    process.exit(1);
  }
}
