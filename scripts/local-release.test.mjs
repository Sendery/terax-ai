import { describe, expect, it } from "vitest";
import {
  buildUpdaterFragment,
  compatibilityAssetName,
  assertReleaseCanStage,
  assertReleaseTargetsCommit,
  assertSigningKeyMatches,
  assertSourceProvenance,
  assertVersionIsNewer,
  mergeUpdaterFragments,
  parseReleaseArgs,
  platformBuildPlan,
  releaseAssetName,
  selectUpdaterPair,
  validateUpdaterFragment,
} from "./local-release-lib.mjs";

describe("local release argument parsing", () => {
  it("requires a semver and supports staged and final publication", () => {
    expect(parseReleaseArgs(["0.9.0", "--draft"]).version).toBe("0.9.0");
    expect(parseReleaseArgs(["v0.9.0", "--publish"]).publish).toBe(true);
    expect(parseReleaseArgs(["--publish", "0.9.0"]).publish).toBe(true);
    expect(() => parseReleaseArgs(["banana"])).toThrow("valid semantic version");
    expect(() => parseReleaseArgs(["0.9.0-beta.1"])).toThrow(
      "stable semantic version",
    );
  });
});

describe("release safety guards", () => {
  it("allows a missing or draft release but rejects a published release", () => {
    expect(() => assertReleaseCanStage(null)).not.toThrow();
    expect(() => assertReleaseCanStage({ draft: true })).not.toThrow();
    expect(() => assertReleaseCanStage({ draft: false })).toThrow(
      "already published",
    );
  });

  it("pins an existing draft release to the exact source commit", () => {
    expect(() =>
      assertReleaseTargetsCommit({ target_commitish: "abc123" }, "abc123"),
    ).not.toThrow();
    expect(() =>
      assertReleaseTargetsCommit({ target_commitish: "develop" }, "abc123"),
    ).toThrow("exact source commit");
  });

  it("requires a clean develop checkout matching origin/develop", () => {
    expect(() =>
      assertSourceProvenance({
        status: "",
        branch: "develop",
        head: "abc",
        remoteHead: "abc",
      }),
    ).not.toThrow();
    expect(() =>
      assertSourceProvenance({
        status: "?? local.ts",
        branch: "develop",
        head: "abc",
        remoteHead: "abc",
      }),
    ).toThrow("including untracked files");
    expect(() =>
      assertSourceProvenance({
        status: "",
        branch: "feature",
        head: "abc",
        remoteHead: "abc",
      }),
    ).toThrow("develop branch");
    expect(() =>
      assertSourceProvenance({
        status: "",
        branch: "develop",
        head: "abc",
        remoteHead: "def",
      }),
    ).toThrow("exactly match");
  });

  it("requires a version newer than the latest stable release", () => {
    expect(() => assertVersionIsNewer("0.9.0", null)).not.toThrow();
    expect(() => assertVersionIsNewer("0.9.0", "v0.8.5")).not.toThrow();
    expect(() => assertVersionIsNewer("0.10.0", "v0.9.9")).not.toThrow();
    expect(() => assertVersionIsNewer("0.8.5", "v0.8.5")).toThrow(
      "strictly newer",
    );
    expect(() => assertVersionIsNewer("0.8.4", "v0.8.5")).toThrow(
      "strictly newer",
    );
  });

  it("matches the key id embedded in minisign public keys and signatures", () => {
    const keyId = Buffer.from("0102030405060708", "hex");
    const packet = (prefix) =>
      Buffer.concat([Buffer.from(prefix), keyId, Buffer.alloc(16)]).toString(
        "base64",
      );
    const publicText = `untrusted comment: key\n${packet("Ed")}\n`;
    const signatureText = `untrusted comment: signature\n${packet("ED")}\n`;
    const encodedPublicKey = Buffer.from(publicText).toString("base64");
    expect(() =>
      assertSigningKeyMatches(encodedPublicKey, signatureText),
    ).not.toThrow();
    const otherSignature = `untrusted comment: signature\n${Buffer.concat([
      Buffer.from("ED"),
      Buffer.alloc(8, 9),
      Buffer.alloc(16),
    ]).toString("base64")}\n`;
    expect(() =>
      assertSigningKeyMatches(encodedPublicKey, otherSignature),
    ).toThrow("does not match");
  });
});

describe("local release platform plans", () => {
  it.each([
    ["linux", "x64", undefined, "linux-x86_64", ["appimage", "deb", "rpm"]],
    ["win32", "x64", undefined, "windows-x86_64", ["nsis", "msi"]],
    ["darwin", "arm64", undefined, "darwin-aarch64", ["app", "dmg"]],
    [
      "darwin",
      "arm64",
      "x86_64-apple-darwin",
      "darwin-x86_64",
      ["app", "dmg"],
    ],
  ])(
    "maps %s/%s/%s to updater target %s",
    (platform, arch, target, updaterTarget, bundles) => {
      const plan = platformBuildPlan({ platform, arch, target });
      expect(plan.updaterTarget).toBe(updaterTarget);
      expect(plan.bundles).toEqual(bundles);
      expect(plan.bundleRoot).toContain("src-tauri/target");
    },
  );

  it("rejects unsupported cross-platform and architecture combinations", () => {
    expect(() =>
      platformBuildPlan({
        platform: "linux",
        arch: "x64",
        target: "aarch64-apple-darwin",
      }),
    ).toThrow("only supported on macOS");
    expect(() => platformBuildPlan({ platform: "win32", arch: "arm64" })).toThrow(
      "Unsupported local release platform",
    );
  });
});

describe("updater artifact planning", () => {
  it.each([
    [
      "linux-x86_64",
      ["bundle/appimage/Terax.AppImage", "bundle/appimage/Terax.AppImage.sig"],
      "bundle/appimage/Terax.AppImage",
    ],
    [
      "windows-x86_64",
      ["bundle/nsis/Terax-setup.exe", "bundle/nsis/Terax-setup.exe.sig"],
      "bundle/nsis/Terax-setup.exe",
    ],
    [
      "darwin-aarch64",
      [
        "bundle/macos/Terax.app.tar.gz",
        "bundle/macos/Terax.app.tar.gz.sig",
      ],
      "bundle/macos/Terax.app.tar.gz",
    ],
  ])("selects a signed updater pair for %s", (target, files, artifact) => {
    expect(selectUpdaterPair(target, files)).toEqual({
      artifact,
      signature: `${artifact}.sig`,
    });
  });

  it("rejects unsigned updater artifacts", () => {
    expect(() =>
      selectUpdaterPair("linux-x86_64", ["bundle/appimage/Terax.AppImage"]),
    ).toThrow("signed updater artifact");
  });

  it("uses collision-free release asset names", () => {
    expect(
      releaseAssetName(
        "0.9.0",
        "darwin-aarch64",
        "Terax.app.tar.gz",
        "0123456789abcdef",
      ),
    ).toBe("Terax_0.9.0_darwin-aarch64_0123456789abcdef.app.tar.gz");
  });

  it("preserves the stable Nix installer aliases", () => {
    expect(
      compatibilityAssetName("0.9.0", "linux-x86_64", "Terax.deb"),
    ).toBe("Terax_0.9.0_amd64.deb");
    expect(
      compatibilityAssetName(
        "0.9.0",
        "darwin-aarch64",
        "Terax.app.tar.gz",
      ),
    ).toBe("Terax_aarch64.app.tar.gz");
    expect(
      compatibilityAssetName(
        "0.9.0",
        "windows-x86_64",
        "Terax-setup.exe",
      ),
    ).toBeNull();
  });
});

describe("updater manifest fragments", () => {
  it("embeds signature content and the Sendery release URL", () => {
    expect(
      buildUpdaterFragment({
        version: "0.9.0",
        updaterTarget: "linux-x86_64",
        assetName: "Terax_0.9.0_linux-x86_64_0123456789abcdef.AppImage",
        signature: "signed-content",
        repository: "Sendery/terax-ai",
        commit: "abc123",
      }),
    ).toEqual({
      version: "0.9.0",
      commit: "abc123",
      platforms: {
        "linux-x86_64": {
          signature: "signed-content",
          url: "https://github.com/Sendery/terax-ai/releases/download/v0.9.0/Terax_0.9.0_linux-x86_64_0123456789abcdef.AppImage",
        },
      },
    });
  });

  it("rejects fragments that do not match their target, repository, tag, or asset", () => {
    const fragment = buildUpdaterFragment({
      version: "0.9.0",
      updaterTarget: "linux-x86_64",
      assetName: "Terax_0.9.0_linux-x86_64_0123456789abcdef.AppImage",
      signature: "signed-content",
      repository: "Sendery/terax-ai",
      commit: "abc123",
    });
    const context = {
      expectedTarget: "linux-x86_64",
      version: "0.9.0",
      repository: "Sendery/terax-ai",
      assetNames: new Set(["Terax_0.9.0_linux-x86_64_0123456789abcdef.AppImage"]),
      commit: "abc123",
    };
    expect(() => validateUpdaterFragment(fragment, context)).not.toThrow();
    expect(() =>
      validateUpdaterFragment(
        { ...fragment, platforms: { "windows-x86_64": Object.values(fragment.platforms)[0] } },
        context,
      ),
    ).toThrow("exactly target");
    expect(() =>
      validateUpdaterFragment(
        {
          ...fragment,
          platforms: {
            "linux-x86_64": {
              ...fragment.platforms["linux-x86_64"],
              url: "https://example.com/bad.AppImage",
            },
          },
        },
        context,
      ),
    ).toThrow("expected GitHub release");
    expect(() =>
      validateUpdaterFragment({ ...fragment, commit: "def456" }, context),
    ).toThrow("source commit");
    expect(() =>
      validateUpdaterFragment(fragment, {
        ...context,
        expectedTarget: "unknown-x86_64",
      }),
    ).toThrow("supported updater target");
    expect(() =>
      validateUpdaterFragment(
        {
          ...fragment,
          platforms: {
            "linux-x86_64": {
              ...fragment.platforms["linux-x86_64"],
              url: "https://github.com/Sendery/terax-ai/releases/download/v0.9.0/Terax_0.9.0_amd64.deb",
            },
          },
        },
        {
          ...context,
          assetNames: new Set(["Terax_0.9.0_amd64.deb"]),
        },
      ),
    ).toThrow("content digest");
  });

  it("merges fragments only when their versions and source commits agree", () => {
    const linux = {
      version: "0.9.0",
      commit: "abc123",
      platforms: { "linux-x86_64": { url: "linux", signature: "sig-l" } },
    };
    const windows = {
      version: "0.9.0",
      commit: "abc123",
      platforms: { "windows-x86_64": { url: "windows", signature: "sig-w" } },
    };
    expect(mergeUpdaterFragments([linux, windows], "notes")).toMatchObject({
      version: "0.9.0",
      notes: "notes",
      platforms: {
        "linux-x86_64": linux.platforms["linux-x86_64"],
        "windows-x86_64": windows.platforms["windows-x86_64"],
      },
    });
    expect(() =>
      mergeUpdaterFragments([linux, { ...windows, version: "1.0.0" }]),
    ).toThrow("same version");
    expect(() =>
      mergeUpdaterFragments([linux, { ...windows, commit: "def456" }]),
    ).toThrow("same source commit");
  });
});
