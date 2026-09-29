import { describe, expect, it } from "vitest";
import { SANDBOX_PRODUCT_NAME, sandboxConfigOverride } from "./sandbox.mjs";

describe("sandbox config override", () => {
  it("gives the sandbox an identity of its own", () => {
    const override = sandboxConfigOverride({ identifier: "app.crynta.terax" });
    expect(override.identifier).toBe("app.crynta.terax.sandbox");
    expect(override.productName).toBe(SANDBOX_PRODUCT_NAME);
  });

  it("never emits updater artifacts, so it needs no signing key", () => {
    expect(
      sandboxConfigOverride({ identifier: "a", bundle: { createUpdaterArtifacts: true } }).bundle
        .createUpdaterArtifacts,
    ).toBe(false);
  });

  it("does not stack the suffix when the base is already a sandbox", () => {
    expect(sandboxConfigOverride({ identifier: "a.sandbox" }).identifier).toBe("a.sandbox");
  });

  it("renames every window and keeps the rest of its settings", () => {
    const override = sandboxConfigOverride({
      identifier: "a",
      app: { windows: [{ title: "Terax", width: 800, hiddenTitle: true }] },
    });
    expect(override.app.windows).toEqual([
      { title: SANDBOX_PRODUCT_NAME, width: 800, hiddenTitle: true },
    ]);
  });

  it("refuses a config without an identifier to derive from", () => {
    expect(() => sandboxConfigOverride({})).toThrow();
  });
});
