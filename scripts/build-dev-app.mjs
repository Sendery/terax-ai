import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { developmentConfigOverride } from "./dev-release-config.mjs";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The debug development bundle requires Apple Silicon.");
}
const root = fileURLToPath(new URL("../", import.meta.url));
const base = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "terax-debug-app-"));
const config = join(temporary, "tauri.debug.json");
try {
  writeFileSync(config, JSON.stringify(developmentConfigOverride(base)));
  const result = spawnSync(process.execPath, [
    join(root, "scripts/tauri-native.mjs"),
    "build", "--debug", "--bundles", "app", "--no-sign", "--config", config,
  ], {
    cwd: root,
    env: {
      ...process.env,
      RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? "1.97.1-aarch64-apple-darwin",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
