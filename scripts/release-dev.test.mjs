import { describe, expect, it } from "vitest";
import {
  developmentArtifacts,
  downloadAssetName,
  nativeBuildPlan,
  parseDevReleaseArgs,
} from "./release-dev.mjs";

describe("development release helper", () => {
  it("parses a dev version into its release tag", () => {
    expect(parseDevReleaseArgs(["0.9.0-dev.4"])).toMatchObject({ tag: "v0.9.0-dev.4", upload: true });
  });
  it("rejects stable versions and unsupported native hosts", () => {
    expect(() => parseDevReleaseArgs(["0.9.0"])).toThrow("development semver");
    expect(() => nativeBuildPlan("linux", "arm64")).toThrow("matching native host");
  });
  it("uses native installer sets", () => {
    expect(nativeBuildPlan("linux", "x64").bundles).toBe("appimage,deb,rpm");
    expect(nativeBuildPlan("win32", "x64").bundles).toBe("nsis,msi");
  });

  it("builds one universal macOS artifact from either Mac host", () => {
    for (const arch of ["arm64", "x64"]) {
      const plan = nativeBuildPlan("darwin", arch);
      expect(plan.target).toBe("universal-apple-darwin");
      expect(plan.root).toBe("src-tauri/target/universal-apple-darwin/release/bundle");
      expect(plan.rustTargets).toEqual([
        "aarch64-apple-darwin",
        "x86_64-apple-darwin",
      ]);
      expect(plan.label).toBe("macOS Apple Silicon + Intel");
    }
  });

  it("renames macOS downloads to the hardware names users recognise", () => {
    expect(downloadAssetName("Pi-Terax_0.9.0-dev.8_universal.dmg")).toBe(
      "Pi-Terax_0.9.0-dev.8_apple_silicon_intel.dmg",
    );
    expect(downloadAssetName("Pi-Terax_0.9.0-dev.8_aarch64.dmg")).toBe(
      "Pi-Terax_0.9.0-dev.8_apple_silicon.dmg",
    );
    expect(downloadAssetName("Pi-Terax_0.9.0-dev.8_x64.dmg")).toBe(
      "Pi-Terax_0.9.0-dev.8_intel.dmg",
    );
  });

  it("leaves non-macOS installer names untouched", () => {
    for (const name of [
      "Pi-Terax_0.9.0-dev.8_amd64.deb",
      "Pi-Terax_0.9.0-dev.8_amd64.AppImage",
      "Pi-Terax-0.9.0-dev.8-1.x86_64.rpm",
      "Pi-Terax_0.9.0-dev.8_x64-setup.exe",
    ]) {
      expect(downloadAssetName(name)).toBe(name);
    }
  });
  it("returns no artifacts for a missing output directory", () => {
    expect(developmentArtifacts("/definitely/missing/terax-release")).toEqual([]);
  });
});
