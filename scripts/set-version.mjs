#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Every file that carries the visible release version. `build-version.mjs`
 * snapshots and restores exactly this list, so a temporary versioned build can
 * never leave the working tree dirty. Keep it as the single source of truth:
 * a file written here but missing from the restore list breaks the next release
 * staging run, which requires a completely clean tree.
 */
export const VERSION_FILES = [
  "package.json",
  "packages/pi-terax/package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Rewrite only the top-level `"version"` field in place. Re-serialising the whole
 * document would reformat unrelated lines (the formatter keeps short arrays
 * inline, `JSON.stringify` always expands them), producing diff churn that hides
 * the actual version bump.
 */
function updateJsonVersion(path, version) {
  const original = readFileSync(path, "utf8");
  const pattern = /^(  "version": )"[^"]*"/m;
  if (!pattern.test(original)) {
    throw new Error(`No top-level "version" field found in ${path}`);
  }
  const next = original.replace(pattern, `$1"${version}"`);
  if (JSON.parse(next).version !== version) {
    throw new Error(`Failed to set the top-level version in ${path}`);
  }
  return next;
}

function updateText(path, updater) {
  return updater(readFileSync(path, "utf8"));
}

export function versionUpdates(version) {
  const updates = new Map();

  for (const path of [
    "package.json",
    "packages/pi-terax/package.json",
    "src-tauri/tauri.conf.json",
  ]) {
    updates.set(path, updateJsonVersion(path, version));
  }

  updates.set(
    "src-tauri/Cargo.toml",
    updateText("src-tauri/Cargo.toml", (text) =>
      text.replace(/(^\[package\][\s\S]*?^version = )"[^"]+"/m, `$1"${version}"`),
    ),
  );

  updates.set(
    "src-tauri/Cargo.lock",
    updateText("src-tauri/Cargo.lock", (text) =>
      text.replace(
        /(\[\[package\]\]\nname = "terax"\nversion = )"[^"]+"/,
        `$1"${version}"`,
      ),
    ),
  );

  return updates;
}

function main() {
  const version = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!version || version === "--help" || version === "-h") {
    console.log("Usage: pnpm version:set <semver> [--dry-run]");
    process.exit(version ? 0 : 1);
  }

  if (!SEMVER.test(version)) {
    console.error(`Invalid semver: ${version}`);
    process.exit(1);
  }

  for (const [path, next] of versionUpdates(version)) {
    const current = readFileSync(path, "utf8");
    if (current === next) continue;
    console.log(`${dryRun ? "would update" : "updated"} ${path}`);
    if (!dryRun) writeFileSync(path, next);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
