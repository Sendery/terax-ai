import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const scriptPath = new URL("./release-dev-macos.sh", import.meta.url);

describe("macOS development release script", () => {
  it("refuses to run on non-macOS hosts before making changes", () => {
    const result = spawnSync("bash", [scriptPath.pathname], {
      encoding: "utf8",
      env: { ...process.env, TERAX_HOST_OS: "Linux" },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("requires macOS");
  });

  it("builds one universal macOS artifact without signed updater artifacts", () => {
    const script = readFileSync(scriptPath, "utf8");

    // Both Rust targets must be installed because the universal build links them.
    expect(script).toContain("rustup target add aarch64-apple-darwin");
    expect(script).toContain("rustup target add x86_64-apple-darwin");
    expect(script).toContain("--target universal-apple-darwin");
    expect(script).toContain("scripts/dev-release-config.mjs");
    expect(script).toContain("--no-sign");
    expect(script).toContain("gh release upload");
    expect(script).toContain("target_commitish");
  });

  it("publishes the universal DMG under the hardware name users recognise", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("apple_silicon_intel");
    // A single universal build replaces the old pair of per-architecture builds.
    expect(script).not.toContain("INTEL_DMG");
  });

  it("verifies the built binary really contains both architectures", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("lipo -archs");
    expect(script).toContain("arm64");
  });
});
