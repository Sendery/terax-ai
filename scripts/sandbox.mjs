#!/usr/bin/env node
/**
 * Run or build Terax as a sandbox, to validate a build without touching the
 * installed app.
 *
 * The sandbox carries its own bundle identifier (`<identifier>.sandbox`), so
 * everything Tauri keys on the identifier is its own: stores, window state,
 * notification identity and macOS permissions. The Rust side scopes the rest
 * (cache root, waker unit, keychain writes) and seeds the sandbox with a copy
 * of the installed app's stores on first launch; see `src-tauri/src/modules/
 * profile.rs`. It never emits updater artifacts, so it needs no signing key.
 *
 * On macOS a build is signed with the local identity when the keychain has it
 * (`macSigningIdentity`), like the development release. Unsigned, it carries
 * the linker's ad hoc signature, which changes with every build, so each
 * sandbox build would be asked for every macOS permission again.
 *
 *   pnpm dev:sandbox              tauri dev as the sandbox
 *   pnpm build:sandbox [args...]  tauri build as the sandbox
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMainModule } from "./cli-entrypoint.mjs";
import { macSigningIdentity } from "./dev-release-config.mjs";

export const SANDBOX_SUFFIX = ".sandbox";
export const SANDBOX_PRODUCT_NAME = "Pi-Terax Sandbox";

/**
 * The `--config` override. Windows are emitted in full because Tauri replaces
 * arrays rather than merging them when layering overrides.
 */
export function sandboxConfigOverride(baseConfig = {}, { signingIdentity = null } = {}) {
  const identifier = baseConfig.identifier;
  if (typeof identifier !== "string" || identifier === "") {
    throw new Error("tauri.conf.json has no identifier to derive the sandbox from");
  }
  const override = {
    productName: SANDBOX_PRODUCT_NAME,
    identifier: identifier.endsWith(SANDBOX_SUFFIX)
      ? identifier
      : `${identifier}${SANDBOX_SUFFIX}`,
    bundle: { createUpdaterArtifacts: false },
  };
  // Tauri merges objects, so this keeps the base macOS entitlements.
  if (signingIdentity) override.bundle.macOS = { signingIdentity };
  const windows = baseConfig?.app?.windows;
  if (Array.isArray(windows) && windows.length > 0) {
    override.app = {
      windows: windows.map((window) => ({ ...window, title: SANDBOX_PRODUCT_NAME })),
    };
  }
  return override;
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== "dev" && mode !== "build") {
    console.error("Usage: sandbox.mjs <dev|build> [tauri args...]");
    process.exit(2);
  }
  const baseConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const configPath = join(mkdtempSync(join(tmpdir(), "terax-sandbox-")), "tauri.sandbox.json");
  // `tauri dev` runs the bare binary, which is never signed.
  const signingIdentity = mode === "build" ? macSigningIdentity() : null;
  if (mode === "build" && process.platform === "darwin") {
    console.error(
      signingIdentity
        ? `Signing the sandbox with "${signingIdentity}".`
        : "No local signing identity in the keychain: ad hoc signature, macOS permissions will not survive the next sandbox build.",
    );
  }
  writeFileSync(configPath, JSON.stringify(sandboxConfigOverride(baseConfig, { signingIdentity })));
  const args = ["scripts/tauri-native.mjs", mode, "--config", configPath, ...rest];
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

if (isMainModule(import.meta.url)) main();
