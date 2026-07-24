import { describe, expect, it } from "vitest";
import { RELEASE_PRODUCT_NAME, developmentConfigOverride } from "./dev-release-config.mjs";

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
});
