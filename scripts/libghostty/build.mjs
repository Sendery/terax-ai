#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ensureZig } from "./source.mjs";
import { archiveName, hostTriple } from "./core.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pin = { ...JSON.parse(readFileSync(join(root, "scripts/libghostty/source.json"), "utf8")), ...JSON.parse(readFileSync(join(root, "scripts/libghostty/pin.json"), "utf8")) };
const triple = hostTriple();
if (!pin.targets[triple]) throw new Error(`unsupported producer host ${triple}`);
const source = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
if (process.argv.length !== 4) throw new Error("usage: node scripts/libghostty/build.mjs <Ghostty checkout> <output directory>");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error ?? result.status}`);
}
const rev = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" });
if (rev.stdout.trim() !== pin.commit) throw new Error("Ghostty source commit does not match pin");
const zig = await ensureZig(triple);
const zigVersion = spawnSync(zig, ["version"], { encoding: "utf8" });
if (zigVersion.status !== 0 || zigVersion.stdout.trim() !== pin.zigVersion) throw new Error("provisioned Zig version does not match source pin");
const prefix = join(output, "install");
run(zig, ["build", "-Demit-lib-vt=true", "-Doptimize=ReleaseFast", "-Dcpu=baseline", "-Demit-xcframework=false", "-Dapp-runtime=none", "--prefix", prefix, "--global-cache-dir", join(output, "zig-global-cache")], { cwd: source });
const stage = join(output, "package");
mkdirSync(join(stage, "lib"), { recursive: true });
mkdirSync(join(stage, "share/pkgconfig"), { recursive: true });
const lib = triple.endsWith("windows") ? "ghostty-vt-static.lib" : "libghostty-vt.a";
cpSync(join(prefix, "lib", lib), join(stage, "lib", lib));
cpSync(join(prefix, "include"), join(stage, "include"), { recursive: true });
cpSync(join(source, "LICENSE"), join(stage, "LICENSE"));
const licenses = join(stage, "licenses");
mkdirSync(licenses, { recursive: true });
cpSync(join(dirname(zig), "LICENSE"), join(licenses, "Zig-LICENSE"));
function copyNotices(directory, relative = "") {
  for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
    const child = join(relative, entry.name);
    if (entry.isDirectory()) copyNotices(directory, child);
    else if (entry.isFile() && /(?:^|[\\/])(?:licenses?|copying|notice|copyright)(?:[.\\/-]|$)/i.test(child)) {
      const destination = join(licenses, "dependencies", child);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(directory, child), destination);
    }
  }
}
copyNotices(join(output, "zig-global-cache", "p"));

const pc = readFileSync(join(prefix, "share/pkgconfig/libghostty-vt-static.pc"), "utf8");
if (/^(?:Libs|Requires)\.private:\s*\S/m.test(pc)) throw new Error("unexpected non-vendored private dependency");
writeFileSync(join(stage, "share/pkgconfig/libghostty-vt-static.pc"), pc.replace(/^prefix=.*$/m, "prefix=${pcfiledir}/../.."));
writeFileSync(join(stage, "build.json"), JSON.stringify({ commit: pin.commit, zigVersion: pin.zigVersion, target: pin.targets[triple].rustTarget, optimize: "ReleaseFast", cpu: "baseline" }, null, 2));
const name = archiveName(pin, triple);
run("tar", ["-czf", join(output, name), "-C", stage, "."]);
const hash = createHash("sha256").update(readFileSync(join(output, name))).digest("hex");
writeFileSync(join(output, `${name}.sha256`), `${hash}  ${name}\n`);
console.log(`${hash}  ${name}`);
