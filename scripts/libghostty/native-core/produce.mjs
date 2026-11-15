#!/usr/bin/env node
// Explicit, separately reviewed producer. Never imported by the app build.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertVendoredPkgConfig, hostTriple } from "../core.mjs";
import { loadLicenseBundle, writeLicenseBundle } from "../licenses.mjs";
import { ensureZig } from "../source.mjs";
import { artifactName, assertProducer, canonicalProducerPaths, digest, directory, loadBundle, producerToolEnv, verifySDKSelection, verifySource, inspectDeployment, inspectTestSummary } from "./variant.mjs";

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
    throw new Error("usage: TERAX_EXPLICIT_SOURCE_PRODUCER=1 node scripts/libghostty/native-core/produce.mjs --source <clean pinned Ghostty checkout> --output <new directory outside source>");
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
    throw new Error("native core dependency notices require review");
  }
  const licenses = loadLicenseBundle({ commit: manifest.upstreamCommit, zigVersion: manifest.zigVersion }, source);
  const patch = join(directory, manifest.patch.path);
  run("git", ["-C", source, "apply", "--check", patch]);
  run("git", ["-C", source, "apply", patch]);
  verifySource(manifest, (path) => readFileSync(join(source, path)), "after");
  mkdirSync(output, { recursive: false });
  const zig = await ensureZig("aarch64-macos");
  if (run(zig, ["version"], { stdio: "pipe" }) !== manifest.zigVersion) throw new Error("Zig version mismatch");
  const common = ["-j2", "-Dtarget=" + manifest.producerTarget, "-Demit-exe=false", "-Demit-bench=false", "-Demit-macos-app=false", "-Demit-lib-vt=true", "-Dcpu=baseline", "-Demit-xcframework=false",
    "-Dapp-runtime=none", "--global-cache-dir", join(output, "zig-global-cache")];
  const tests = [
    ["build", "test-lib-vt", "--summary", "all", "-Doptimize=Debug", "-Dtest-filter=native core:", ...common],
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
    const summary = inspectTestSummary(report, manifest.minimumFocusedTests, index !== 0);
    testEvidence.push({ args, ...summary, skippedAllowed: index !== 0 });
  }
  const prefix = join(output, "install");
  run(zig, ["build", "-Doptimize=ReleaseFast", "--prefix", prefix, ...common], { cwd: source });
  verifySource(manifest, (path) => readFileSync(join(source, path)), "after");
  const lib = join(prefix, "lib/libghostty-vt.a");
  const symbols = run("/usr/bin/nm", ["-gU", lib], { stdio: "pipe", maxBuffer: 32 * 1024 * 1024, env: toolEnv });
  for (const abi of manifest.abi) {
    if (!symbols.split("\n").some((line) => line.trim().endsWith("_" + abi))) {
      throw new Error("native archive lacks ABI: " + abi);
    }
  }
  const members = run("/usr/bin/ar", ["-t", lib], { stdio: "pipe" }).split("\n").filter((member) => member && !/^__\.SYMDEF(?: SORTED)?$/.test(member));
  const architectures = run("/usr/bin/lipo", ["-archs", lib], { stdio: "pipe" });
  if (architectures !== "arm64") throw new Error("unexpected native archive architecture: " + architectures);
  const loadCommands = run("/usr/bin/otool", ["-l", lib], { stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(output, "macho-load-commands.log"), loadCommands);
  const deploymentObjects = inspectDeployment(loadCommands, members, manifest.minimumMacOS);
  const minimumOS = [...new Set(deploymentObjects.map((item) => item.minimumMacOS))];
  const stage = join(output, "package");
  mkdirSync(join(stage, "share/pkgconfig"), { recursive: true });
  mkdirSync(join(stage, "lib"), { recursive: true });
  cpSync(lib, join(stage, "lib/libghostty-vt.a"));
  cpSync(join(prefix, "include"), join(stage, "include"), { recursive: true });
  cpSync(join(source, "LICENSE"), join(stage, "LICENSE"));
  writeLicenseBundle(licenses, join(stage, "licenses"));
  cpSync(directory, join(stage, "share/terax-native-core"), {
    recursive: true, filter: (path) => !path.endsWith(".node-test.mjs"),
  });
  writeFileSync(join(stage, "share/terax-native-core/producer-toolchain.json"),
    JSON.stringify(toolchain.metadata, null, 2) + "\n");
  const pc = readFileSync(join(prefix, "share/pkgconfig/libghostty-vt-static.pc"), "utf8");
  assertVendoredPkgConfig(pc);
  writeFileSync(join(stage, "share/pkgconfig/libghostty-vt-static.pc"),
    pc.replace(/^prefix=.*$/m, "prefix=" + "$" + "{pcfiledir}/../.."));
  writeFileSync(join(stage, "build.json"), JSON.stringify({
    upstreamCommit: manifest.upstreamCommit, variant: manifest.variant,
    patchSha256: manifest.patch.sha256, manifestSha256: digest(readFileSync(join(directory, "manifest.json"))),
    zigVersion: manifest.zigVersion, target: "aarch64-apple-darwin", optimize: "ReleaseFast",
    cpu: "baseline", producerTarget: manifest.producerTarget, deploymentObjects, architectures, jobs: 2, systemToolPrefix: ["/usr/bin", "/bin"], minimumOS, toolchain: actualToolchain, toolchainProvenance: toolchain.metadata, nativeTests: testEvidence, nativeTestsPassed: true, capabilities: manifest.abi,
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
