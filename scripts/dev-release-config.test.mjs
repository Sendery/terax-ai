import { describe, expect, it } from "vitest";
import {
  LOCAL_SIGNING_IDENTITY,
  RELEASE_PRODUCT_NAME,
  developmentConfigOverride,
  macSigningIdentity,
  tauriSignArgs,
} from "./dev-release-config.mjs";

describe("development release config override", () => {
  it("rebrands the product name and disables updater artifacts", () => {
    const override = developmentConfigOverride({
      productName: "Terax",
      bundle: { createUpdaterArtifacts: true },
    });

    expect(RELEASE_PRODUCT_NAME).toBe("Pi-Terax");
    expect(override.productName).toBe("Pi-Terax");
    expect(override.bundle.createUpdaterArtifacts).toBe(false);
  });

  it("renames every window title while preserving other window settings", () => {
    const override = developmentConfigOverride({
      app: { windows: [{ title: "Terax", width: 800, height: 600, hiddenTitle: true }] },
    });

    expect(override.app.windows).toHaveLength(1);
    expect(override.app.windows[0]).toEqual({
      title: "Pi-Terax",
      width: 800,
      height: 600,
      hiddenTitle: true,
    });
  });

  it("leaves the bundle identifier untouched (stays in the upstream lineage)", () => {
    const override = developmentConfigOverride({ identifier: "app.crynta.terax" });

    expect(override.identifier).toBeUndefined();
  });

  it("omits the window override when the base config declares no windows", () => {
    const override = developmentConfigOverride({});

    expect(override.app).toBeUndefined();
    expect(override.productName).toBe("Pi-Terax");
  });

  it("signs with a stable identity when one is given and leaves it unset otherwise", () => {
    const signed = developmentConfigOverride({}, { signingIdentity: LOCAL_SIGNING_IDENTITY });
    expect(signed.bundle.macOS).toEqual({ signingIdentity: LOCAL_SIGNING_IDENTITY });
    expect(signed.bundle.createUpdaterArtifacts).toBe(false);

    expect(developmentConfigOverride({}).bundle.macOS).toBeUndefined();
  });

  it("only skips tauri signing when there is no identity", () => {
    expect(tauriSignArgs(LOCAL_SIGNING_IDENTITY)).toEqual([]);
    expect(tauriSignArgs(null)).toEqual(["--no-sign"]);
  });
});

describe("macOS signing identity", () => {
  const keychain = `  1) 4B6D9A9C16DECCE72AF96B44A95B640229909057 "${LOCAL_SIGNING_IDENTITY}" (CSSMERR_TP_NOT_TRUSTED)\n`;

  it("uses the local identity when the keychain has it, even untrusted", () => {
    expect(macSigningIdentity({ platform: "darwin", env: {}, listIdentities: () => keychain })).toBe(LOCAL_SIGNING_IDENTITY);
  });

  it("falls back to ad hoc when the identity is missing", () => {
    expect(macSigningIdentity({ platform: "darwin", env: {}, listIdentities: () => "" })).toBeNull();
  });

  it("honours an override and the ad hoc escape hatch", () => {
    const sha = "4B6D9A9C16DECCE72AF96B44A95B640229909057";
    expect(
      macSigningIdentity({ platform: "darwin", env: { TERAX_MACOS_SIGNING_IDENTITY: sha }, listIdentities: () => keychain }),
    ).toBe(sha);
    expect(
      macSigningIdentity({ platform: "darwin", env: { TERAX_MACOS_SIGNING_IDENTITY: "-" }, listIdentities: () => keychain }),
    ).toBeNull();
  });

  it("never signs off macOS", () => {
    expect(macSigningIdentity({ platform: "linux", env: {}, listIdentities: () => keychain })).toBeNull();
  });
});
