import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const directory = dirname(fileURLToPath(import.meta.url));
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assertPath(path) {
  if (typeof path !== "string" || path.startsWith("/") || path === "." || path === ".." || path.includes("\\") ||
      path.includes(":") || path.startsWith("../") || posix.normalize(path) !== path) {
    throw new Error("invalid history manifest path");
  }
}

export function validateBundle(manifest, read) {
  if (manifest.schema !== 1 || manifest.variant !== "exact-history-rows-v1" ||
      manifest.upstreamCommit !== "a887df42c56f6de86c0fe6da9c4eeca37931e083" ||
      manifest.zigVersion !== "0.15.2" || manifest.files.length !== 7) {
    throw new Error("unsupported history source identity");
  }
  for (const patch of [manifest.patch, manifest.rustWrapper.patch, manifest.rustSys.patch]) {
    assertPath(patch.path);
    if (digest(read(patch.path)) !== patch.sha256) throw new Error("history patch checksum mismatch");
  }
  const paths = new Set();
  for (const file of manifest.files) {
    assertPath(file.path);
    if (paths.has(file.path)) throw new Error("duplicate history source path");
    paths.add(file.path);
    for (const field of ["beforeSha256", "afterSha256"]) {
      if (!/^[a-f0-9]{64}$/.test(file[field])) throw new Error("invalid history source checksum");
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
      throw new Error("unexpected " + phase + " history source: " + file.path);
    }
  }
}

export function artifactName(manifest) {
  return "libghostty-vt-" + manifest.crateVersion + "-a887df4-terax-history1-" +
    manifest.patch.sha256.slice(0, 12) + "-aarch64-macos.tar.gz";
}

export function assertProducer(host, explicit) {
  if (host !== "aarch64-macos" || explicit !== "1") {
    throw new Error("history producer requires explicit source opt-in on arm64 macOS");
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
