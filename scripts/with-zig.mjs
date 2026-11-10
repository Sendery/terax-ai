#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync, readdirSync, lstatSync } from "node:fs";
import { dirname, join, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveName, hostTriple, parseArgs, prebuiltEnv, selectedTarget, verifyChecksum } from "./libghostty/core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
  return result;
}

async function main() {
  const { source, command } = parseArgs(process.argv.slice(2));
  if (source) {
    run(process.execPath, [join(ROOT, "scripts/libghostty/source.mjs"), "--", ...command]);
    return;
  }
  const pin = { ...JSON.parse(readFileSync(join(ROOT, "scripts/libghostty/source.json"), "utf8")), ...JSON.parse(readFileSync(join(ROOT, "scripts/libghostty/pin.json"), "utf8")) };
  const triple = hostTriple();
  const target = selectedTarget(pin, triple, process.env, command);
  if (process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime) throw new Error("prebuilt Linux requires glibc");
  const base = join(ROOT, "src-tauri/target/toolchains");
  const archive = join(base, archiveName(pin, triple));
  const final = join(base, `${pin.releaseTag}-${triple}-${target.sha256.slice(0, 16)}`);
  mkdirSync(base, { recursive: true });
  let bytes;
  if (existsSync(archive)) bytes = readFileSync(archive);
  else {
    const url = `https://github.com/${pin.repository}/releases/download/${pin.releaseTag}/${archiveName(pin, triple)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`prebuilt download failed: HTTP ${response.status}; no source fallback`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  verifyChecksum(bytes, target.sha256);
  if (!existsSync(archive)) writeFileSync(archive, bytes, { flag: "wx" });
  const staging = `${final}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    mkdirSync(staging);
    run("tar", ["-xzf", archive, "-C", staging]);
    const libName = process.platform === "win32" ? "ghostty-vt-static.lib" : "libghostty-vt.a";
    for (const file of [`lib/${libName}`, "include/ghostty/vt.h", "share/pkgconfig/libghostty-vt-static.pc"]) {
      if (!existsSync(join(staging, file))) throw new Error(`invalid prebuilt archive: missing ${file}`);
    }
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
  const pkgdir = join(final, "share/pkgconfig");
  const env = prebuiltEnv(process.env, target.rustTarget, pkgdir, "pkg-config");
  run("pkg-config", ["--static", "--libs", "--cflags", "libghostty-vt-static"], { env });
  const guard = join(final, "no-zig");
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
  run(command[0], command.slice(1), { env, shell: process.platform === "win32" });
}

try { await main(); } catch (error) {
  process.stderr.write(`with-zig: ${error.message}\n`);
  process.exitCode = 1;
}
