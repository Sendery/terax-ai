#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const help = args.includes("--help") || args.includes("-h");
const strict = args.includes("--strict");
const clean = args.includes("--clean");
const tauriArgs = args.filter((arg) => !["--strict", "--clean"].includes(arg));

if (help) {
  console.log("Usage: pnpm build:installers [--clean] [--strict] [tauri build args]");
  console.log("");
  console.log("Examples:");
  console.log("  pnpm build:installers");
  console.log("  pnpm build:installers -- --bundles msi,nsis");
  console.log("  pnpm build:installers -- --clean --strict --bundles dmg");
  console.log("");
  console.log("Notes:");
  console.log("  --clean removes src-tauri/target/release/bundle before building.");
  console.log("  --strict fails on any tauri build non-zero exit, including signing errors.");
  process.exit(0);
}

const cargoBin = join(homedir(), ".cargo", "bin");
const pathSep = process.platform === "win32" ? ";" : ":";
const pathKey =
  Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
  "PATH";
const env = {
  ...process.env,
  [pathKey]: `${cargoBin}${pathSep}${process.env[pathKey] ?? ""}`,
};

const bundleDir = join(root, "src-tauri", "target", "release", "bundle");
const startedAt = Date.now();

if (clean && existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true });
  console.log(`removed ${bundleDir}`);
}

console.log(`running: pnpm tauri build ${tauriArgs.join(" ")}`.trim());
const result = spawnSync("pnpm", ["tauri", "build", ...tauriArgs], {
  cwd: root,
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

const artifacts = collectArtifacts(bundleDir).filter(
  (artifact) => artifact.mtimeMs >= startedAt - 5000,
);

if (artifacts.length > 0) {
  console.log("");
  console.log("Installable artifacts generated:");
  for (const artifact of artifacts) {
    console.log(`- ${artifact.path} (${formatBytes(artifact.size)})`);
  }
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

const status = result.status ?? 1;
if (status === 0) {
  process.exit(0);
}

if (!strict && artifacts.length > 0) {
  console.log("");
  console.log(
    "tauri build exited non-zero after producing installers. This commonly happens when updater signing is configured but TAURI_SIGNING_PRIVATE_KEY is not set.",
  );
  console.log("Use --strict if CI should fail in that case.");
  process.exit(0);
}

process.exit(status);

function collectArtifacts(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  walk(dir, out);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = statSync(path);
    out.push({
      path,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
