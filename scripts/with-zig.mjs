#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync, readdirSync, lstatSync } from "node:fs";
import { dirname, join, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveName, hostTriple, nativeCoreHosts, parseArgs, prebuiltEnv, selectedTarget, verifyChecksum } from "./libghostty/core.mjs";
import { provisionalPin } from "./libghostty/provisional.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
  return result;
}

async function prepareArchive({ pin, triple, target, localArchive, archiveRoot, nativeCore, verifyPackage }) {
  const base = join(ROOT, "src-tauri/target/toolchains", ...(nativeCore ? ["native-core-v1"] : archiveRoot ? ["provisional"] : []));
  const archive = join(base, archiveName(pin, triple));
  const final = join(base, `${pin.releaseTag}-${triple}-${target.sha256.slice(0, 16)}`);
  mkdirSync(base, { recursive: true });
  let bytes;
  if (localArchive) bytes = readFileSync(resolve(localArchive));
  else if (existsSync(archive)) bytes = readFileSync(archive);
  else {
    const url = `https://github.com/${pin.repository}/releases/download/${pin.releaseTag}/${archiveName(pin, triple)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`prebuilt download failed for ${triple}: HTTP ${response.status}; use a pinned archive via TERAX_GHOSTTY_ARCHIVE_DIR`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  verifyChecksum(bytes, target.sha256);
  if (existsSync(archive)) verifyChecksum(readFileSync(archive), target.sha256);
  else {
    try { writeFileSync(archive, bytes, { flag: "wx" }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      verifyChecksum(readFileSync(archive), target.sha256);
    }
  }
  const staging = `${final}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    mkdirSync(staging);
    run("tar", ["-xzf", archive, "-C", staging, ...(archiveRoot ? ["--strip-components", "1"] : [])]);
    const libName = triple.endsWith("-windows") ? "ghostty-vt-static.lib" : "libghostty-vt.a";
    for (const file of [`lib/${libName}`, "include/ghostty/vt.h", "share/pkgconfig/libghostty-vt-static.pc"]) {
      if (!existsSync(join(staging, file))) throw new Error(`invalid prebuilt archive: missing ${file}`);
    }
    verifyPackage?.((path) => readFileSync(join(staging, path)));
    const pcRelative = "share/pkgconfig/libghostty-vt-static.pc";
    const prefix = final.replaceAll("\\", "/").replaceAll(" ", "\\ ");
    const pc = join(staging, pcRelative);
    writeFileSync(pc, readFileSync(pc, "utf8").replace(/^prefix=.*$/m, `prefix=${prefix}`));
    function verifyTree(relative = "") {
      for (const entry of readdirSync(join(staging, relative))) {
        const child = join(relative, entry);
        const source = join(staging, child);
        const cached = join(final, child);
        const stat = lstatSync(source);
        if (stat.isDirectory()) verifyTree(child);
        else if (!stat.isFile() || !existsSync(cached) || !lstatSync(cached).isFile() || !readFileSync(source).equals(readFileSync(cached))) {
          throw new Error(`prebuilt cache is corrupt: ${cached}; remove this cache directory and retry`);
        }
      }
    }
    if (existsSync(final)) verifyTree();
    else {
      try { renameSync(staging, final); }
      catch (error) {
        if (!existsSync(final)) throw error;
        verifyTree();
      }
    }
  } finally { rmSync(staging, { recursive: true, force: true }); }
  return final;
}

async function main() {
  const { source, provisional, variant, nativeCore, archive: variantArchive, command } = parseArgs(process.argv.slice(2));
  if (source) {
    run(process.execPath, [join(ROOT, "scripts/libghostty/source.mjs"), "--", ...command]);
    return;
  }
  const readJson = (path) => JSON.parse(readFileSync(join(ROOT, "scripts/libghostty", path), "utf8"));
  const sourcePin = { ...readJson("source.json"), ...readJson("pin.json") };
  const host = hostTriple();
  if (process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error("prebuilt Linux requires glibc");
  }

  const core = variant || nativeCore
    ? await import("./libghostty/native-core/consumer.mjs")
    : null;
  const manifest = core ? readJson("native-core/manifest.json") : null;
  const armReceipt = core ? readJson("native-core/consumer.json") : null;
  const triples = nativeCore ? nativeCoreHosts(host, command, process.env) : [host];
  let env;
  let guard;
  for (const triple of triples) {
    let pin = sourcePin;
    let archiveRoot;
    let verifyPackage;
    let localArchive = provisional || variantArchive;
    if (provisional) {
      const provisionalManifest = readJson("provisional.json");
      pin = provisionalPin(pin, provisionalManifest, triple);
      archiveRoot = provisionalManifest.archiveRoot;
    }
    if (core) {
      pin = core.consumerPin(sourcePin, manifest, armReceipt, triple);
      const receipt = core.receiptForHost(sourcePin, armReceipt, triple);
      verifyPackage = (read) => core.validatePackage(manifest, receipt, read);
      if (nativeCore) {
        const archiveDir = process.env.TERAX_GHOSTTY_ARCHIVE_DIR;
        const configured = archiveDir && join(archiveDir, archiveName(pin, triple));
        localArchive = (triple === host && process.env.TERAX_GHOSTTY_ARCHIVE) ||
          (configured && existsSync(configured) ? configured : undefined);
      }
    }
    const target = nativeCore
      ? selectedTarget(pin, triple)
      : selectedTarget(pin, triple, process.env, command);
    const final = await prepareArchive({
      pin, triple, target, localArchive, archiveRoot,
      nativeCore: !!core, verifyPackage,
    });
    const pkgdir = join(final, "share/pkgconfig");
    const targetEnv = prebuiltEnv(process.env, target.rustTarget, pkgdir, "pkg-config");
    run("pkg-config", ["--static", "--libs", "--cflags", "libghostty-vt-static"], { env: targetEnv });
    env ??= targetEnv;
    env[`PKG_CONFIG_${target.rustTarget}`] = targetEnv[`PKG_CONFIG_${target.rustTarget}`];
    env[`PKG_CONFIG_PATH_${target.rustTarget}`] = targetEnv[`PKG_CONFIG_PATH_${target.rustTarget}`];
    guard ??= join(final, "no-zig");
  }
  mkdirSync(guard, { recursive: true });
  const guardBody = "#!/bin/sh\necho 'prebuilt mode forbids Zig: pkg-config route failed' >&2\nexit 97\n";
  writeFileSync(join(guard, "zig"), guardBody);
  chmodSync(join(guard, "zig"), 0o755);
  writeFileSync(join(guard, "zig.cmd"), "@echo prebuilt mode forbids Zig: pkg-config route failed 1>&2\r\n@exit /b 97\r\n");
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${guard}${delimiter}${env[pathKey] ?? ""}`;
  if (process.platform === "win32") {
    const source = join(guard, "guard.rs");
    writeFileSync(source, 'fn main() { eprintln!("prebuilt mode forbids Zig: pkg-config route failed"); std::process::exit(97); }');
    if (!existsSync(join(guard, "zig.exe"))) run("rustc", [source, "-o", join(guard, "zig.exe")]);
  }
  const shell = process.platform === "win32" && /(?:^|[\\/])(?:pnpm|[^\\/]+\.(?:cmd|bat))$/i.test(command[0]);
  run(command[0], command.slice(1), { env, shell });
}

try { await main(); } catch (error) {
  process.stderr.write(`with-zig: ${error.message}\n`);
  process.exitCode = 1;
}
