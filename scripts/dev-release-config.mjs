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
import { readFileSync } from "node:fs";

export const RELEASE_PRODUCT_NAME = "Pi-Terax";

/**
 * Derive the config override from the checked-out base config so window
 * settings other than the title are preserved verbatim. The window array is
 * emitted in full because Tauri replaces (rather than deep-merges) arrays when
 * layering `--config` overrides.
 */
export function developmentConfigOverride(baseConfig = {}) {
  const override = {
    productName: RELEASE_PRODUCT_NAME,
    bundle: { createUpdaterArtifacts: false },
  };
  const windows = baseConfig?.app?.windows;
  if (Array.isArray(windows) && windows.length > 0) {
    override.app = {
      windows: windows.map((window) => ({ ...window, title: RELEASE_PRODUCT_NAME })),
    };
  }
  return override;
}

function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error("Usage: dev-release-config.mjs <path/to/tauri.conf.json>");
    process.exit(1);
  }
  const baseConfig = JSON.parse(readFileSync(configPath, "utf8"));
  process.stdout.write(JSON.stringify(developmentConfigOverride(baseConfig)));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
