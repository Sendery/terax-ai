import { describe, expect, it } from "vitest";
import {
  compareSemver,
  extensionInstallSnippet,
  extensionReleaseAssetUrl,
  isNewerVersion,
  parseSemver,
  pickLatestRelease,
  releasesApiUrl,
  selectExtensionAsset,
  selectPlatformAsset,
  type GithubRelease,
  type GithubReleaseAsset,
} from "./releases";

function rel(
  tag: string,
  prerelease: boolean,
  extra: Partial<GithubRelease> = {},
): GithubRelease {
  return {
    tag_name: tag,
    prerelease,
    html_url: `https://github.com/Sendery/terax-ai/releases/tag/${tag}`,
    ...extra,
  };
}

describe("parseSemver", () => {
  it("parses stable versions with no prerelease ordinal", () => {
    expect(parseSemver("v1.2.3")).toEqual({ base: [1, 2, 3], pre: null });
  });

  it("parses dev versions with a numeric prerelease ordinal", () => {
    expect(parseSemver("0.9.0-dev.2")).toEqual({ base: [0, 9, 0], pre: 2 });
  });
});

describe("compareSemver", () => {
  it("orders by base version first", () => {
    expect(compareSemver("1.0.1", "1.0.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "1.1.0")).toBeLessThan(0);
  });

  it("treats a stable release as newer than a prerelease of the same base", () => {
    expect(compareSemver("0.9.0", "0.9.0-dev.5")).toBeGreaterThan(0);
  });

  it("orders dev prereleases by their ordinal", () => {
    expect(compareSemver("0.9.0-dev.2", "0.9.0-dev.1")).toBeGreaterThan(0);
    expect(compareSemver("0.9.0-dev.1", "0.9.0-dev.2")).toBeLessThan(0);
  });
});

describe("isNewerVersion", () => {
  it("is true only for strictly newer versions", () => {
    expect(isNewerVersion("0.9.0-dev.2", "0.9.0-dev.1")).toBe(true);
    expect(isNewerVersion("0.9.0-dev.1", "0.9.0-dev.1")).toBe(false);
    expect(isNewerVersion("0.8.0", "0.9.0")).toBe(false);
  });
});

describe("pickLatestRelease", () => {
  const releases = [
    rel("v0.8.0", false),
    rel("v0.9.0-dev.1", true),
    rel("v0.9.0-dev.2", true),
    rel("v0.7.0", false),
    rel("v1.0.0-dev.1", true, { draft: true }),
  ];

  it("selects the newest stable, ignoring prereleases and drafts", () => {
    expect(pickLatestRelease(releases, "stable")?.tag_name).toBe("v0.8.0");
  });

  it("selects the newest published dev prerelease, ignoring drafts", () => {
    expect(pickLatestRelease(releases, "dev")?.tag_name).toBe("v0.9.0-dev.2");
  });

  it("returns null when a channel has no published release", () => {
    expect(pickLatestRelease([rel("v1.0.0", false)], "dev")).toBeNull();
  });
});

describe("selectPlatformAsset", () => {
  function asset(name: string): GithubReleaseAsset {
    return {
      name,
      browser_download_url: `https://github.com/Sendery/terax-ai/releases/download/v0.9.0-dev.3/${name}`,
    };
  }
  const macAssets = [asset("Terax_0.9.0-3_aarch64.dmg"), asset("Terax_0.9.0-3_x64.dmg")];
  const allAssets = [
    asset("Terax_0.9.0-1_aarch64.dmg"),
    asset("Terax_0.9.0-1_x64.dmg"),
    asset("Terax_0.9.0-1_amd64.AppImage"),
    asset("Terax_0.9.0-1_amd64.deb"),
    asset("Terax-0.9.0-1-1.x86_64.rpm"),
    asset("Terax_0.9.0-1_x64-setup.exe"),
    asset("Terax_0.9.0-1_x64_en-US.msi"),
  ];

  it("picks the apple-silicon dmg on macOS aarch64", () => {
    expect(selectPlatformAsset(macAssets, "macos", "aarch64")?.name).toBe(
      "Terax_0.9.0-3_aarch64.dmg",
    );
  });

  it("picks the intel dmg on macOS x86_64", () => {
    expect(selectPlatformAsset(macAssets, "macos", "x86_64")?.name).toBe(
      "Terax_0.9.0-3_x64.dmg",
    );
  });

  it("falls back to the only dmg when the arch token is absent", () => {
    const single = [asset("Terax_0.9.0-3_universal.dmg")];
    expect(selectPlatformAsset(single, "macos", "aarch64")?.name).toBe(
      "Terax_0.9.0-3_universal.dmg",
    );
  });

  it("prefers the setup exe over the msi on Windows x86_64", () => {
    expect(selectPlatformAsset(allAssets, "windows", "x86_64")?.name).toBe(
      "Terax_0.9.0-1_x64-setup.exe",
    );
  });

  it("prefers the AppImage on Linux x86_64", () => {
    expect(selectPlatformAsset(allAssets, "linux", "x86_64")?.name).toBe(
      "Terax_0.9.0-1_amd64.AppImage",
    );
  });

  it("returns the resolved download url alongside the name", () => {
    expect(selectPlatformAsset(macAssets, "macos", "aarch64")?.url).toBe(
      "https://github.com/Sendery/terax-ai/releases/download/v0.9.0-dev.3/Terax_0.9.0-3_aarch64.dmg",
    );
  });

  it("returns null when no asset matches the platform", () => {
    expect(selectPlatformAsset(macAssets, "windows", "x86_64")).toBeNull();
    expect(selectPlatformAsset(undefined, "macos", "aarch64")).toBeNull();
    expect(selectPlatformAsset([], "macos", "aarch64")).toBeNull();
  });
});

function releaseAsset(name: string): GithubReleaseAsset {
  return {
    name,
    browser_download_url: `https://github.com/Sendery/terax-ai/releases/download/v0.9.0-dev.3/${name}`,
  };
}

describe("selectExtensionAsset", () => {
  const asset = releaseAsset;
  const ext = asset("pi-terax-extension_0.9.0-dev.3.tgz");
  const mixed = [
    asset("Terax_0.9.0-3_aarch64.dmg"),
    ext,
    asset("latest.json"),
  ];

  it("finds the companion extension tarball regardless of other assets", () => {
    expect(selectExtensionAsset(mixed)).toEqual({
      name: "pi-terax-extension_0.9.0-dev.3.tgz",
      url: "https://github.com/Sendery/terax-ai/releases/download/v0.9.0-dev.3/pi-terax-extension_0.9.0-dev.3.tgz",
    });
  });

  it("returns null when no extension asset is present", () => {
    expect(selectExtensionAsset([asset("Terax_0.9.0-3_aarch64.dmg")])).toBeNull();
    expect(selectExtensionAsset(undefined)).toBeNull();
    expect(selectExtensionAsset([])).toBeNull();
  });
});

describe("extensionInstallSnippet", () => {
  const url =
    "https://github.com/Sendery/terax-ai/releases/download/v0.9.0/pi-terax-extension_0.9.0.tgz";

  it("emits a single-line bash command for macOS and Linux", () => {
    const mac = extensionInstallSnippet("macos", url);
    expect(mac).toBe(extensionInstallSnippet("linux", url));
    expect(mac).not.toContain("\n");
    expect(mac).toContain("curl -fsSL");
    expect(mac).toContain(url);
    expect(mac).toContain(" && ");
    expect(mac).toContain("tar -xzf");
    expect(mac).toContain("npm install --omit=dev");
    expect(mac).toContain("pi install");
    expect(mac).not.toContain("Invoke-WebRequest");
  });

  it("emits a single-line PowerShell command for Windows", () => {
    const win = extensionInstallSnippet("windows", url);
    expect(win).not.toContain("\n");
    expect(win).toContain("Invoke-WebRequest");
    expect(win).toContain(url);
    expect(win).toContain("; ");
    expect(win).toContain("npm install --omit=dev");
    expect(win).toContain("pi install");
    expect(win).not.toContain("curl -fsSL");
  });

  it("defaults to the bash block when the OS is unknown", () => {
    expect(extensionInstallSnippet(null, url)).toBe(
      extensionInstallSnippet("linux", url),
    );
  });
});

describe("extensionReleaseAssetUrl", () => {
  it("builds the release-asset download url from repository and version", () => {
    expect(extensionReleaseAssetUrl("Sendery/terax-ai", "0.9.0")).toBe(
      "https://github.com/Sendery/terax-ai/releases/download/v0.9.0/pi-terax-extension_0.9.0.tgz",
    );
  });

  it("tolerates a leading v on the version", () => {
    expect(extensionReleaseAssetUrl("Sendery/terax-ai", "v1.2.3")).toBe(
      "https://github.com/Sendery/terax-ai/releases/download/v1.2.3/pi-terax-extension_1.2.3.tgz",
    );
  });

  it("preserves pre-release version segments", () => {
    expect(extensionReleaseAssetUrl("Sendery/terax-ai", "1.0.0-dev.3")).toBe(
      "https://github.com/Sendery/terax-ai/releases/download/v1.0.0-dev.3/pi-terax-extension_1.0.0-dev.3.tgz",
    );
  });
});

describe("releasesApiUrl", () => {
  it("derives the api url from the repository slug", () => {
    expect(releasesApiUrl("Sendery/terax-ai")).toBe(
      "https://api.github.com/repos/Sendery/terax-ai/releases?per_page=100",
    );
  });
});
