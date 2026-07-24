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

  it("builds both macOS architectures without signed updater artifacts", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("aarch64-apple-darwin");
    expect(script).toContain("x86_64-apple-darwin");
    expect(script).toContain("scripts/dev-release-config.mjs");
    expect(script).toContain("--no-sign");
    expect(script).toContain("gh release upload");
    expect(script).toContain("target_commitish");
  });
});
