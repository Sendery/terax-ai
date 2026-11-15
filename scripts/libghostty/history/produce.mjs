#!/usr/bin/env node
// Explicit, separately reviewed producer. Never imported by the app build.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertVendoredPkgConfig, hostTriple } from "../core.mjs";
import { loadLicenseBundle, writeLicenseBundle } from "../licenses.mjs";
import { ensureZig } from "../source.mjs";
import { artifactName, assertProducer, canonicalProducerPaths, digest, directory, loadBundle, producerToolEnv, verifySDKSelection, verifySource } from "./variant.mjs";

const toolEnv = producerToolEnv(process.env);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit", ...options, env: toolEnv });
  if (result.status !== 0) throw new Error(command + " failed: " + (result.error ?? result.status));
  return result.stdout?.trim() ?? "";
}

export async function main(argv = process.argv.slice(2)) {
  process.env.PATH = toolEnv.PATH;
  assertProducer(hostTriple(), process.env.TERAX_EXPLICIT_SOURCE_PRODUCER);
  if (argv.length !== 4 || argv[0] !== "--source" || argv[2] !== "--output") {
    throw new Error("usage: TERAX_EXPLICIT_SOURCE_PRODUCER=1 node scripts/libghostty/history/produce.mjs --source <clean pinned Ghostty checkout> --output <new directory outside source>");
  }
  const { source, output } = canonicalProducerPaths(argv[1], argv[3]);
  const manifest = loadBundle();
  const profilePath = process.env.TERAX_GHOSTTY_SDK_PROVENANCE;
  if (!profilePath || !process.env.DEVELOPER_DIR || process.env.ZIG_LIBC) {
    throw new Error("explicit verified SDK provenance and DEVELOPER_DIR are required; ZIG_LIBC must be unset");
  }
  const toolchain = JSON.parse(readFileSync(profilePath, "utf8"));
  if (toolchain.schema !== 1 || toolchain.metadata.packages.length !== 4) {
    throw new Error("invalid producer toolchain provenance");
  }
  const selectedSdk = realpathSync(run("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], { stdio: "pipe" }));
  const actualToolchain = {
    developerDir: realpathSync(process.env.DEVELOPER_DIR), sdkPath: selectedSdk,
    sdkVersion: run("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-version"], { stdio: "pipe" }),
    sdkSettingsSha256: digest(readFileSync(join(selectedSdk, "SDKSettings.json"))),
    libSystemSha256: digest(readFileSync(join(selectedSdk, "usr/lib/libSystem.tbd"))),
  };
  verifySDKSelection(toolchain.selected, actualToolchain);
  toolEnv.DEVELOPER_DIR = actualToolchain.developerDir;
  process.env.DEVELOPER_DIR = toolEnv.DEVELOPER_DIR;

  if (run("git", ["-C", source, "rev-parse", "HEAD"], { stdio: "pipe" }) !== manifest.upstreamCommit ||
      run("git", ["-C", source, "status", "--porcelain", "--untracked-files=all"], { stdio: "pipe" })) {
    throw new Error("producer requires an untouched checkout at the exact upstream commit");
  }
  verifySource(manifest, (path) => readFileSync(join(source, path)), "before");
  const repo = resolve(directory, "../../..");
  const licenseManifest = readFileSync(join(repo, "scripts/libghostty/licenses/manifest.json"));
  if (digest(licenseManifest) !== manifest.license.dependencyManifestSha256 ||
      digest(readFileSync(join(source, "LICENSE"))) !== manifest.license.sha256) {
    throw new Error("history dependency notices require review");
  }
  const licenses = loadLicenseBundle({ commit: manifest.upstreamCommit, zigVersion: manifest.zigVersion }, source);
  const patch = join(directory, manifest.patch.path);
  run("git", ["-C", source, "apply", "--check", patch]);
  run("git", ["-C", source, "apply", patch]);
  verifySource(manifest, (path) => readFileSync(join(source, path)), "after");
  mkdirSync(output, { recursive: false });
  const zig = await ensureZig("aarch64-macos");
  if (run(zig, ["version"], { stdio: "pipe" }) !== manifest.zigVersion) throw new Error("Zig version mismatch");
  const common = ["-j2", "-Demit-lib-vt=true", "-Dcpu=baseline", "-Demit-xcframework=false",
    "-Dapp-runtime=none", "--global-cache-dir", join(output, "zig-global-cache")];
  const tests = [
    ["build", "test-lib-vt", "--summary", "all", "-Doptimize=Debug", "-Dtest-filter=row retention:", ...common],
    ["build", "test-lib-vt", "--summary", "all", "-Doptimize=Debug", ...common],
  ];
  const testEvidence = [];
  for (const [index, args] of tests.entries()) {
    const result = spawnSync(zig, args, { cwd: source, encoding: "utf8",
      stdio: "pipe", maxBuffer: 32 * 1024 * 1024, env: toolEnv });
    const report = (result.stdout ?? "") + (result.stderr ?? "");
    writeFileSync(join(output, index === 0 ? "focused-tests.log" : "all-tests.log"), report);
    process.stdout.write(report);
    if (result.status !== 0) throw new Error("native test step failed: " + (result.error ?? result.status));
    const counts = [...report.matchAll(/\b(\d+)\/(\d+) tests passed\b/g)]
      .map((match) => Number(match[1]));
    if (!counts.length || Math.max(...counts) < manifest.minimumFocusedTests) {
      throw new Error("native test summary did not prove the expected behavior tests ran");
    }
    testEvidence.push({ args, passedFromSummary: Math.max(...counts) });
  }
  const prefix = join(output, "install");
  run(zig, ["build", "-Doptimize=ReleaseFast", "--prefix", prefix, ...common], { cwd: source });
  verifySource(manifest, (path) => readFileSync(join(source, path)), "after");
  const lib = join(prefix, "lib/libghostty-vt.a");
  const symbols = run("/usr/bin/nm", ["-gU", lib], { stdio: "pipe", maxBuffer: 32 * 1024 * 1024, env: toolEnv });
  if (!symbols.split("\n").some((line) => /\b_ghostty_terminal_set_scrollback_limit_rows$/.test(line))) {
    throw new Error("native archive lacks exact history ABI");
  }
  const loadCommands = run("/usr/bin/otool", ["-l", lib], { stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(output, "macho-load-commands.log"), loadCommands);
  const minimumOS = [...new Set([
    ...[...loadCommands.matchAll(/\bminos\s+([0-9.]+)/g)].map((match) => match[1]),
    ...[...loadCommands.matchAll(/cmd LC_VERSION_MIN_MACOSX[\s\S]*?\bversion\s+([0-9.]+)/g)].map((match) => match[1]),
  ])];
  if (!minimumOS.length) throw new Error("could not inspect native object minimum macOS versions");
  const stage = join(output, "package");
  mkdirSync(join(stage, "share/pkgconfig"), { recursive: true });
  mkdirSync(join(stage, "lib"), { recursive: true });
  cpSync(lib, join(stage, "lib/libghostty-vt.a"));
  cpSync(join(prefix, "include"), join(stage, "include"), { recursive: true });
  cpSync(join(source, "LICENSE"), join(stage, "LICENSE"));
  writeLicenseBundle(licenses, join(stage, "licenses"));
  cpSync(directory, join(stage, "share/terax-history"), {
    recursive: true, filter: (path) => !path.endsWith(".node-test.mjs"),
  });
  writeFileSync(join(stage, "share/terax-history/producer-toolchain.json"),
    JSON.stringify(toolchain.metadata, null, 2) + "\n");
  const pc = readFileSync(join(prefix, "share/pkgconfig/libghostty-vt-static.pc"), "utf8");
  assertVendoredPkgConfig(pc);
  writeFileSync(join(stage, "share/pkgconfig/libghostty-vt-static.pc"),
    pc.replace(/^prefix=.*$/m, "prefix=" + "$" + "{pcfiledir}/../.."));
  writeFileSync(join(stage, "build.json"), JSON.stringify({
    upstreamCommit: manifest.upstreamCommit, variant: manifest.variant,
    patchSha256: manifest.patch.sha256, manifestSha256: digest(readFileSync(join(directory, "manifest.json"))),
    zigVersion: manifest.zigVersion, target: "aarch64-apple-darwin", optimize: "ReleaseFast",
    cpu: "baseline", jobs: 2, systemToolPrefix: ["/usr/bin", "/bin"], minimumOS, toolchain: actualToolchain, toolchainProvenance: toolchain.metadata, nativeTests: testEvidence, nativeTestsPassed: true, capabilities: manifest.abi,
    terminalHeaderSha256: digest(readFileSync(join(prefix, "include/ghostty/vt/terminal.h"))),
  }, null, 2) + "\n");
  const archive = join(output, artifactName(manifest));
  run("tar", ["-czf", archive, "-C", stage, "."]);
  const hash = digest(readFileSync(archive));
  writeFileSync(archive + ".sha256", hash + "  " + artifactName(manifest) + "\n");
  console.log(hash + "  " + archive);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
