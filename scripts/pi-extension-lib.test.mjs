import { describe, expect, it } from "vitest";
import {
  EXTENSION_ASSET_PREFIX,
  extensionAssetName,
  hardenExtensionManifest,
  parseExtensionAssetVersion,
} from "./pi-extension-lib.mjs";

describe("companion extension asset naming", () => {
  it("builds a predictable, versioned, prefixed asset name", () => {
    expect(extensionAssetName("0.9.0")).toBe("pi-terax-extension_0.9.0.tgz");
    expect(extensionAssetName("1.2.3-dev.4")).toBe(
      "pi-terax-extension_1.2.3-dev.4.tgz",
    );
    expect(extensionAssetName("0.9.0").startsWith(EXTENSION_ASSET_PREFIX)).toBe(true);
  });

  it("rejects an empty or non-string version", () => {
    expect(() => extensionAssetName("")).toThrow("version");
    expect(() => extensionAssetName(undefined)).toThrow("version");
  });

  it("recovers the version from an asset name and ignores foreign assets", () => {
    expect(parseExtensionAssetVersion("pi-terax-extension_0.9.0.tgz")).toBe("0.9.0");
    expect(parseExtensionAssetVersion("pi-terax-extension_1.2.3-dev.4.tgz")).toBe(
      "1.2.3-dev.4",
    );
    expect(parseExtensionAssetVersion("Terax_0.9.0_darwin-aarch64_abc.dmg")).toBe(
      null,
    );
    expect(parseExtensionAssetVersion("pi-terax-extension_0.9.0.zip")).toBe(null);
  });
});

describe("companion extension manifest hardening", () => {
  const source = {
    name: "@crynta/pi-terax",
    version: "0.1.0",
    type: "module",
    license: "Apache-2.0",
    keywords: ["pi-package"],
    files: ["dist", "skills", "README.md"],
    exports: { ".": { import: "./dist/index.js" } },
    pi: { extensions: ["./dist/extension.js"], skills: ["./skills"] },
    scripts: { build: "tsc", test: "vitest run" },
    peerDependencies: {
      "@earendil-works/pi-coding-agent": "^0.80.3",
      typebox: "^1.1.38",
    },
    devDependencies: { typescript: "~6.0.3", typebox: "1.1.38", vitest: "^4.1.7" },
  };

  it("renames and versions the companion package", () => {
    const out = hardenExtensionManifest(source, "0.9.0");
    expect(out.name).toBe("pi-terax-extension");
    expect(out.version).toBe("0.9.0");
  });

  it("promotes typebox to a runtime dependency (Pi installs with --omit=dev)", () => {
    const out = hardenExtensionManifest(source, "0.9.0");
    expect(out.dependencies.typebox).toBe("^1.1.38");
    expect(out.peerDependencies).toEqual({
      "@earendil-works/pi-coding-agent": "^0.80.3",
    });
  });

  it("keeps the Pi contract fields and drops dev-only noise", () => {
    const out = hardenExtensionManifest(source, "0.9.0");
    expect(out.pi).toEqual(source.pi);
    expect(out.keywords).toContain("pi-package");
    expect(out.files).toEqual(source.files);
    expect(out.exports).toEqual(source.exports);
    expect(out.devDependencies).toBeUndefined();
    expect(out.scripts).toBeUndefined();
  });

  it("does not mutate the source manifest", () => {
    const snapshot = JSON.parse(JSON.stringify(source));
    hardenExtensionManifest(source, "0.9.0");
    expect(source).toEqual(snapshot);
  });

  it("requires the pi extension contract to be present", () => {
    const { pi, ...withoutPi } = source;
    expect(() => hardenExtensionManifest(withoutPi, "0.9.0")).toThrow("pi.extensions");
  });
});
