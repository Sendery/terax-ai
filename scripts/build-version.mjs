#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const version = args[0];
const keepVersion = args.includes("--keep-version");
const separator = args.indexOf("--");
const tauriArgs =
  separator >= 0
    ? args.slice(separator + 1)
    : args.slice(1).filter((arg) => arg !== "--keep-version");

if (!version || version === "--help" || version === "-h") {
  console.log(
    "Usage: pnpm build:version <semver> [--keep-version] [-- <tauri build args>]",
  );
  console.log("Example: pnpm build:version 0.8.0 -- --bundles appimage");
  process.exit(version ? 0 : 1);
}

const files = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];
const snapshots = new Map(
  files.map((path) => [path, readFileSync(path, "utf8")]),
);
const cargoBin = join(homedir(), ".cargo", "bin");
const env = {
  ...process.env,
  PATH: `${cargoBin}:${process.env.PATH ?? ""}`,
};

function run(command, runArgs) {
  const result = spawnSync(command, runArgs, {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  run("node", ["scripts/set-version.mjs", version]);
  run("pnpm", ["tauri", "build", ...tauriArgs]);
} finally {
  if (!keepVersion) {
    for (const [path, content] of snapshots) writeFileSync(path, content);
    console.log("restored project version files");
  }
}
