#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!version || version === "--help" || version === "-h") {
  console.log("Usage: pnpm version:set <semver> [--dry-run]");
  process.exit(version ? 0 : 1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid semver: ${version}`);
  process.exit(1);
}

function updateJson(path, updater) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  updater(json);
  return `${JSON.stringify(json, null, 2)}\n`;
}

function updateText(path, updater) {
  return updater(readFileSync(path, "utf8"));
}

const updates = new Map();

updates.set(
  "package.json",
  updateJson("package.json", (json) => {
    json.version = version;
  }),
);

updates.set(
  "packages/pi-terax/package.json",
  updateJson("packages/pi-terax/package.json", (json) => {
    json.version = version;
  }),
);

updates.set(
  "src-tauri/tauri.conf.json",
  updateJson("src-tauri/tauri.conf.json", (json) => {
    json.version = version;
  }),
);

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

for (const [path, next] of updates) {
  const current = readFileSync(path, "utf8");
  if (current === next) continue;
  console.log(`${dryRun ? "would update" : "updated"} ${path}`);
  if (!dryRun) writeFileSync(path, next);
}
