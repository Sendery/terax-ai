import { createHash } from "node:crypto";
import { delimiter } from "node:path";

export function hostTriple(platform = process.platform, arch = process.arch) {
  const os = { darwin: "macos", linux: "linux", win32: "windows" }[platform];
  const cpu = { arm64: "aarch64", x64: "x86_64" }[arch];
  return os && cpu ? `${cpu}-${os}` : null;
}

export function parseArgs(args) {
  const split = args.indexOf("--");
  if (split < 0 || split === args.length - 1) throw new Error("usage: node scripts/with-zig.mjs [--source | --provisional <archive>] -- <command> [args...]");
  const flags = args.slice(0, split);
  if (flags.length === 1 && flags[0] === "--native-core") {
    return { source: false, nativeCore: true, command: args.slice(split + 1) };
  }
  if (flags[0] === "--variant") {
    if (flags.length !== 4 || flags[1] !== "native-core-v1" || flags[2] !== "--archive" ||
        !flags[3] || flags[3].startsWith("--")) throw new Error("native core variant requires one local archive");
    return { source: false, variant: flags[1], archive: flags[3], command: args.slice(split + 1) };
  }
  if (flags[0] === "--provisional") {
    if (flags.length !== 2 || !flags[1] || flags[1].startsWith("--")) throw new Error("provisional mode requires one local archive");
    return { source: false, provisional: flags[1], command: args.slice(split + 1) };
  }
  if (flags.some((flag) => flag !== "--source") || flags.length > 1) throw new Error("unknown wrapper option");
  return { source: flags.includes("--source"), command: args.slice(split + 1) };
}

export function selectedTarget(pin, triple, env = {}, command = []) {
  const target = pin.targets[triple];
  if (!target) throw new Error(`no prebuilt target for ${triple}; source builds require explicit --source`);
  const requested = env.CARGO_BUILD_TARGET;
  const targets = command.flatMap((arg, i) => arg === "--target" ? [command[i + 1]] : arg.startsWith("--target=") ? [arg.slice(9)] : []);
  if ([requested, ...targets].filter(Boolean).some((value) => value !== target.rustTarget)) throw new Error("prebuilt cross-compilation is not supported");
  if (!/^[a-f0-9]{64}$/.test(target.sha256 ?? "")) throw new Error(`prebuilt ${triple} is not published and checksum-pinned yet; no source fallback`);
  return target;
}

export function nativeCoreHosts(triple, command, env = {}) {
  const targets = new Set(command.flatMap((arg, i) =>
    arg === "--target" ? [command[i + 1]] : arg.startsWith("--target=") ? [arg.slice(9)] : [],
  ));
  if (env.CARGO_BUILD_TARGET) targets.add(env.CARGO_BUILD_TARGET);
  if (!targets.size) return [triple];
  if (targets.size !== 1) throw new Error("conflicting native core targets");
  const [target] = targets;
  if (triple?.endsWith("-macos")) {
    if (target === "universal-apple-darwin") {
      return [triple, triple === "aarch64-macos" ? "x86_64-macos" : "aarch64-macos"];
    }
    if (target === "aarch64-apple-darwin") return ["aarch64-macos"];
    if (target === "x86_64-apple-darwin") return ["x86_64-macos"];
  }
  if (target === ({
    "x86_64-linux": "x86_64-unknown-linux-gnu",
    "aarch64-linux": "aarch64-unknown-linux-gnu",
    "x86_64-windows": "x86_64-pc-windows-msvc",
  })[triple]) return [triple];
  throw new Error(`unsupported native core target ${target} on ${triple}`);
}

export function verifyChecksum(bytes, expected) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`);
}

export function archiveName(pin, triple) {
  return `libghostty-vt-${pin.crateVersion}-${pin.commit.slice(0, 7)}-${triple}.tar.gz`;
}

export function prebuiltEnv(base, target, pkgdir, pkgconfig) {
  if (base.TERAX_GHOSTTY_SOURCE_BUILD !== undefined) throw new Error("TERAX_GHOSTTY_SOURCE_BUILD conflicts with prebuilt mode");
  if (base.GHOSTTY_SOURCE_DIR) throw new Error("GHOSTTY_SOURCE_DIR conflicts with prebuilt mode");
  if (base.DOCS_RS) throw new Error("DOCS_RS cannot be used for a prebuilt build");
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (/^(?:HOST_|TARGET_)?PKG_CONFIG(?:_|$)/.test(key) || key.startsWith("LIBGHOSTTY_VT_STATIC_")) delete env[key];
  }
  // Keep system package discovery available for GTK and WebKit dependencies.
  env.PKG_CONFIG = pkgconfig;
  const search = [pkgdir, base.PKG_CONFIG_PATH].filter(Boolean).join(delimiter);
  if (base.PKG_CONFIG_LIBDIR) env.PKG_CONFIG_LIBDIR = base.PKG_CONFIG_LIBDIR;
  if (base.PKG_CONFIG_SYSROOT_DIR) env.PKG_CONFIG_SYSROOT_DIR = base.PKG_CONFIG_SYSROOT_DIR;
  env.PKG_CONFIG_PATH = search;
  env[`PKG_CONFIG_${target}`] = pkgconfig;
  env[`PKG_CONFIG_PATH_${target}`] = search;
  return env;
}

export function assertVendoredPkgConfig(pc) {
  for (const line of pc.split(/\r?\n/)) {
    const field = /^[ \t]*(?:Libs|Requires)\.private[ \t]*:[ \t]*(.*)$/.exec(line);
    if (field?.[1].trim()) throw new Error("unexpected non-vendored private dependency");
  }
}
