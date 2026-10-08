#!/usr/bin/env node
/**
 * Build the Tauri `--config` override used by the development-release builders.
 *
 * Development artifacts rebrand the desktop identity to "Pi-Terax" (product
 * name and window titles) so the installed app is recognisable as the fork on
 * macOS, Windows and Linux, and never emit updater manifests. The bundle
 * identifier and Rust crate name are intentionally left untouched so these
 * releases stay in the upstream `Terax` lineage.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const RELEASE_PRODUCT_NAME = "Pi-Terax";

/**
 * The self-signed certificate development builds are signed with on macOS.
 * macOS keys privacy grants (Full Disk Access, Documents, Desktop...) on the
 * code signature: an ad hoc signature changes with every build, so each new
 * version asked for every permission again. Signing with one stable identity
 * keeps the designated requirement (`identifier "app.crynta.terax" and
 * certificate root = H"..."`) the same across versions, so a grant survives
 * updates. It is not an Apple Developer ID, so Gatekeeper still treats the app
 * as from an unidentified developer.
 */
export const LOCAL_SIGNING_IDENTITY = "Pi-Terax Local Signing";

function keychainCodeSigningIdentities() {
  // No `-v`: a self-signed certificate is not trusted, yet codesign uses it.
  const result = spawnSync("security", ["find-identity", "-p", "codesigning"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

/**
 * The identity to sign macOS development builds with, or null to fall back to
 * an ad hoc signature. `TERAX_MACOS_SIGNING_IDENTITY` names another identity
 * (name or SHA-1); set it to `-` to force ad hoc.
 */
export function macSigningIdentity({
  platform = process.platform,
  env = process.env,
  listIdentities = keychainCodeSigningIdentities,
} = {}) {
  if (platform !== "darwin") return null;
  const wanted = env.TERAX_MACOS_SIGNING_IDENTITY || LOCAL_SIGNING_IDENTITY;
  if (wanted === "-") return null;
  return listIdentities().includes(wanted) ? wanted : null;
}

/** `tauri build` flags matching the identity: unsigned builds skip signing. */
export function tauriSignArgs(signingIdentity) {
  return signingIdentity ? [] : ["--no-sign"];
}

/**
 * Derive the config override from the checked-out base config so window
 * settings other than the title are preserved verbatim. The window array is
 * emitted in full because Tauri replaces (rather than deep-merges) arrays when
 * layering `--config` overrides.
 */
export function developmentConfigOverride(baseConfig = {}, { signingIdentity = null } = {}) {
  const override = {
    productName: RELEASE_PRODUCT_NAME,
    bundle: { createUpdaterArtifacts: false },
  };
  // Tauri merges objects, so this keeps the base macOS entitlements.
  if (signingIdentity) override.bundle.macOS = { signingIdentity };
  const windows = baseConfig?.app?.windows;
  if (Array.isArray(windows) && windows.length > 0) {
    override.app = {
      windows: windows.map((window) => ({ ...window, title: RELEASE_PRODUCT_NAME })),
    };
  }
  return override;
}

function main() {
  const signingIdentity = macSigningIdentity();
  if (process.argv[2] === "--sign-args") {
    process.stdout.write(tauriSignArgs(signingIdentity).join(" "));
    return;
  }
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: dev-release-config.mjs <path/to/tauri.conf.json> | --sign-args");
    process.exit(1);
  }
  if (process.platform === "darwin") {
    console.error(
      signingIdentity
        ? `Signing with "${signingIdentity}"; build without --no-sign.`
        : `No "${LOCAL_SIGNING_IDENTITY}" identity in the keychain: ad hoc signature, macOS permissions will not survive updates.`,
    );
  }
  const baseConfig = JSON.parse(readFileSync(configPath, "utf8"));
  process.stdout.write(JSON.stringify(developmentConfigOverride(baseConfig, { signingIdentity })));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
