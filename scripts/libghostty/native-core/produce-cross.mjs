#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archiveName, assertVendoredPkgConfig, hostTriple } from "../core.mjs";
import { loadLicenseBundle, writeLicenseBundle } from "../licenses.mjs";
import {
  canonicalProducerPaths,
  digest,
  directory,
  inspectDeployment,
  loadBundle,
  verifySource,
} from "./variant.mjs";

const targets = {
  "x86_64-macos": ["x86_64-macos.11.0", "x86_64-apple-darwin"],
  "x86_64-linux": ["x86_64-linux-gnu.2.35", "x86_64-unknown-linux-gnu"],
  "aarch64-linux": ["aarch64-linux-gnu.2.35", "aarch64-unknown-linux-gnu"],
  "x86_64-windows": ["x86_64-windows-msvc", "x86_64-pc-windows-msvc"],
};

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${executable} failed: ${result.error ?? result.status ?? result.signal}`);
  }
  return result.stdout?.trim();
}

const [input, destination, triple] = process.argv.slice(2);
if (
  process.argv.length !== 5 || !Object.hasOwn(targets, triple) ||
  hostTriple() !== "aarch64-macos" || process.env.TERAX_EXPLICIT_SOURCE_PRODUCER !== "1"
) {
  throw new Error("usage on Apple Silicon: TERAX_EXPLICIT_SOURCE_PRODUCER=1 node scripts/libghostty/native-core/produce-cross.mjs <clean pinned checkout> <new output directory> <target>");
}

const { source, output } = canonicalProducerPaths(input, destination);
const manifest = loadBundle();
const [zigTarget, rustTarget] = targets[triple];
const pipe = { stdio: ["ignore", "pipe", "inherit"] };
const zig = process.env.TERAX_GHOSTTY_ZIG || "/opt/homebrew/bin/zig";
if (run(zig, ["version"], pipe) !== manifest.zigVersion) throw new Error("Zig version mismatch");
if (
  run("git", ["-C", source, "rev-parse", "HEAD"], pipe) !== manifest.upstreamCommit ||
  run("git", ["-C", source, "status", "--porcelain", "--untracked-files=all"], pipe)
) throw new Error("producer requires an untouched checkout at the exact upstream commit");
verifySource(manifest, (path) => readFileSync(join(source, path)), "before");
const licenseManifest = readFileSync(new URL("../licenses/manifest.json", import.meta.url));
if (
  digest(licenseManifest) !== manifest.license.dependencyManifestSha256 ||
  digest(readFileSync(join(source, "LICENSE"))) !== manifest.license.sha256
) throw new Error("native core dependency notices require review");
const licenses = loadLicenseBundle({ commit: manifest.upstreamCommit, zigVersion: manifest.zigVersion }, source);
mkdirSync(output);
const checkout = join(output, "source");
run("git", ["clone", "--quiet", "--shared", "--no-checkout", source, checkout]);
run("git", ["-C", checkout, "checkout", "--quiet", "--detach", manifest.upstreamCommit]);
run("git", ["-C", checkout, "apply", join(directory, manifest.patch.path)]);
verifySource(manifest, (path) => readFileSync(join(checkout, path)), "after");

const prefix = join(output, "install");
run(zig, [
  "build", "-j2", `-Dtarget=${zigTarget}`, "-Dcpu=baseline", "-Doptimize=ReleaseFast",
  "-Demit-exe=false", "-Demit-bench=false", "-Demit-macos-app=false", "-Demit-lib-vt=true",
  "-Demit-xcframework=false", "-Dapp-runtime=none", "--prefix", prefix,
], { cwd: checkout });
const windows = triple.endsWith("-windows");
const macOS = triple.endsWith("-macos");
const libName = windows ? "ghostty-vt-static.lib" : "libghostty-vt.a";
const lib = join(prefix, "lib", libName);
const nm = run("xcrun", ["-f", "llvm-nm"], pipe);
const symbols = run(nm, ["--extern-only", "--defined-only", lib], pipe);
for (const symbol of manifest.abi) {
  const label = macOS ? `_${symbol}` : symbol;
  if (!symbols.split("\n").some((line) => line.trim().endsWith(` ${label}`))) {
    throw new Error(`missing export ${label}`);
  }
}
writeFileSync(join(output, "exports.log"), symbols + "\n");
const archiver = run("xcrun", ["-f", "llvm-ar"], pipe);
const members = run(archiver, ["t", lib], pipe).split("\n");
if (!members.length || !members[0]) throw new Error("empty static archive");
let deploymentObjects;
if (macOS) {
  if (run("lipo", ["-archs", lib], pipe) !== "x86_64") throw new Error("expected x86_64 Mach-O");
  deploymentObjects = inspectDeployment(run("otool", ["-l", lib], pipe), members, manifest.minimumMacOS);
}

const stage = join(output, "package");
mkdirSync(join(stage, "lib"), { recursive: true });
mkdirSync(join(stage, "share/pkgconfig"), { recursive: true });
mkdirSync(join(stage, "share/terax-native-core"), { recursive: true });
cpSync(lib, join(stage, "lib", libName));
cpSync(join(prefix, "include"), join(stage, "include"), { recursive: true });
cpSync(join(checkout, "LICENSE"), join(stage, "LICENSE"));
writeLicenseBundle(licenses, join(stage, "licenses"));
cpSync(join(directory, "manifest.json"), join(stage, "share/terax-native-core/manifest.json"));
const manifestSha256 = digest(readFileSync(join(directory, "manifest.json")));
const terminalHeaderSha256 = digest(readFileSync(join(stage, "include/ghostty/vt/terminal.h")));
const relativePc = "share/pkgconfig/libghostty-vt-static.pc";
const pc = readFileSync(join(prefix, relativePc), "utf8");
assertVendoredPkgConfig(pc);
writeFileSync(join(stage, relativePc), pc.replace(/^prefix=.*$/m, "prefix=${pcfiledir}/../.."));
writeFileSync(join(stage, "build.json"), JSON.stringify({
  upstreamCommit: manifest.upstreamCommit,
  variant: manifest.variant,
  patchSha256: manifest.patch.sha256,
  manifestSha256,
  terminalHeaderSha256,
  zigVersion: manifest.zigVersion,
  target: rustTarget,
  producerTarget: zigTarget,
  optimize: "ReleaseFast",
  cpu: "baseline",
  members,
  deploymentObjects,
  capabilities: manifest.abi,
}, null, 2) + "\n");
const name = archiveName({ crateVersion: manifest.crateVersion, commit: manifest.upstreamCommit }, triple);
const archive = join(output, name);
run("tar", ["-czf", archive, "-C", stage, "."]);
const sha256 = digest(readFileSync(archive));
writeFileSync(archive + ".sha256", `${sha256}  ${name}\n`);
console.log(`${sha256}  ${archive}`);
