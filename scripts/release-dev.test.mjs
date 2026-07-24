import { describe, expect, it } from "vitest";
import { developmentArtifacts, nativeBuildPlan, parseDevReleaseArgs } from "./release-dev.mjs";

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
  it("returns no artifacts for a missing output directory", () => {
    expect(developmentArtifacts("/definitely/missing/terax-release")).toEqual([]);
  });
});
