import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const directory = dirname(fileURLToPath(import.meta.url));
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assertPath(path) {
  if (typeof path !== "string" || path.startsWith("/") || path === "." || path === ".." || path.includes("\\") ||
      path.includes(":") || path.startsWith("../") || posix.normalize(path) !== path) {
    throw new Error("invalid native core manifest path");
  }
}

export function validateBundle(manifest, read) {
  if (manifest.schema !== 1 || manifest.variant !== "terax-native-core-v1" ||
      manifest.upstreamCommit !== "a887df42c56f6de86c0fe6da9c4eeca37931e083" ||
      manifest.zigVersion !== "0.15.2" || manifest.files.length !== 9 ||
      manifest.producerTarget !== "aarch64-macos.11.0" || manifest.minimumMacOS !== "11.0" ||
      manifest.minimumFocusedTests !== 23 || manifest.abi?.length !== 2 ||
      manifest.abi[0] !== "ghostty_terminal_set_scrollback_limit_rows" ||
      manifest.abi[1] !== "ghostty_terminal_clear_preserving_cursor_row") {
    throw new Error("unsupported native core source identity");
  }
  for (const patch of [manifest.patch]) {
    assertPath(patch.path);
    if (digest(read(patch.path)) !== patch.sha256) throw new Error("native core patch checksum mismatch");
  }
  const paths = new Set();
  for (const file of manifest.files) {
    assertPath(file.path);
    if (paths.has(file.path)) throw new Error("duplicate native core source path");
    paths.add(file.path);
    for (const field of ["beforeSha256", "afterSha256"]) {
      if (!/^[a-f0-9]{64}$/.test(file[field])) throw new Error("invalid native core source checksum");
    }
  }
}

export function loadBundle() {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  validateBundle(manifest, (path) => readFileSync(join(directory, path)));
  return manifest;
}

export function verifySource(manifest, read, phase) {
  if (!["before", "after"].includes(phase)) throw new Error("invalid verification phase");
  for (const file of manifest.files) {
    if (digest(read(file.path)) !== file[phase + "Sha256"]) {
      throw new Error("unexpected " + phase + " native core source: " + file.path);
    }
  }
}

export function artifactName(manifest) {
  return "libghostty-vt-" + manifest.crateVersion + "-a887df4-terax-core1-" +
    manifest.patch.sha256.slice(0, 12) + "-aarch64-macos.tar.gz";
}

export function assertProducer(host, explicit) {
  if (host !== "aarch64-macos" || explicit !== "1") {
    throw new Error("native core producer requires explicit source opt-in on arm64 macOS");
  }
}

export function canonicalProducerPaths(sourceArg, outputArg) {
  const source = realpathSync(resolve(sourceArg));
  const requested = resolve(outputArg);
  const output = join(realpathSync(dirname(requested)), basename(requested));
  const rel = relative(source, output);
  const outside = rel === ".." || rel.startsWith("../") || isAbsolute(rel);
  if (!outside || existsSync(output)) {
    throw new Error("output must be a new directory outside the real source checkout");
  }
  return { source, output };
}

export function verifySDKSelection(expected, actual) {
  for (const key of ["developerDir", "sdkPath", "sdkVersion", "sdkSettingsSha256", "libSystemSha256"]) {
    if (typeof expected[key] !== "string" || expected[key] !== actual[key]) {
      throw new Error("producer SDK selection mismatch: " + key);
    }
  }
}

export function producerToolEnv(input) {
  const system = ["/usr/bin", "/bin"];
  const rest = (input.PATH ?? "").split(delimiter)
    .filter((path) => path && !system.includes(path));
  return { ...input, PATH: [...system, ...rest].join(delimiter) };
}

export function inspectDeployment(loadCommands, expectedMembers, maximum = "11.0") {
  const headers = [...loadCommands.matchAll(/^(.+\.a)\(([^)\n]+)\):[ \t]*$/gm)];
  if (!headers.length || !Array.isArray(expectedMembers) || !expectedMembers.length) {
    throw new Error("missing native object deployment evidence");
  }
  const compare = (version) => {
    if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error("invalid deployment version");
    const a = version.split(".").map(Number), b = maximum.split(".").map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    }
    return 0;
  };
  const observed = headers.map((header, index) => {
    const text = loadCommands.slice(header.index, headers[index + 1]?.index ?? loadCommands.length);
    const modern = [...text.matchAll(/cmd LC_BUILD_VERSION\s+cmdsize \d+\s+platform (\S+)\s+minos ([0-9.]+)/g)];
    const legacy = [...text.matchAll(/cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([0-9.]+)/g)];
    const versions = [...modern.map((match) => match[2]), ...legacy.map((match) => match[1])];
    if (versions.length !== 1 || modern.some((match) => !["1", "macos"].includes(match[1]))) {
      throw new Error("missing or invalid macOS deployment command: " + header[2]);
    }
    if (compare(versions[0]) > 0) throw new Error("native object exceeds macOS " + maximum + ": " + header[2]);
    return { member: header[2], minimumMacOS: versions[0] };
  });
  if (JSON.stringify(observed.map((item) => item.member).sort()) !== JSON.stringify([...expectedMembers].sort())) {
    throw new Error("deployment evidence does not cover every archive member");
  }
  return observed;
}

export function inspectTestSummary(report, minimumCases, allowSkipped) {
  const counts = [...report.matchAll(/\b(\d+)\/(\d+) tests passed\b/g)]
    .map((match) => ({ passed: Number(match[1]), total: Number(match[2]) }));
  if (!counts.length) throw new Error("native test summary is missing");
  const summary = counts.reduce((a, b) => a.total > b.total ? a : b);
  if (summary.passed < minimumCases) throw new Error("native focused behavior cases did not run");
  if (!allowSkipped && (summary.passed !== summary.total || /\b[1-9]\d* skipped\b/.test(report))) {
    throw new Error("focused native cases must execute without skips");
  }
  return summary;
}
