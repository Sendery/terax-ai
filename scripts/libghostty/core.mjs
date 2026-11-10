import { createHash } from "node:crypto";
import { delimiter } from "node:path";

export function hostTriple(platform = process.platform, arch = process.arch) {
  const os = { darwin: "macos", linux: "linux", win32: "windows" }[platform];
  const cpu = { arm64: "aarch64", x64: "x86_64" }[arch];
  return os && cpu ? `${cpu}-${os}` : null;
}

export function parseArgs(args) {
  const split = args.indexOf("--");
  if (split < 0 || split === args.length - 1) throw new Error("usage: node scripts/with-zig.mjs [--source] -- <command> [args...]");
  const flags = args.slice(0, split);
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

export function verifyChecksum(bytes, expected) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`);
}

export function archiveName(pin, triple) {
  return `libghostty-vt-${pin.crateVersion}-${pin.commit.slice(0, 7)}-${triple}.tar.gz`;
}

export function prebuiltEnv(base, target, pkgdir, pkgconfig) {
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
