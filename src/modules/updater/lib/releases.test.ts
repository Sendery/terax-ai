import { describe, expect, it } from "vitest";
import {
  compareSemver,
  isNewerVersion,
  parseSemver,
  pickLatestRelease,
  releasesApiUrl,
  type GithubRelease,
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

describe("releasesApiUrl", () => {
  it("derives the api url from the repository slug", () => {
    expect(releasesApiUrl("Sendery/terax-ai")).toBe(
      "https://api.github.com/repos/Sendery/terax-ai/releases?per_page=100",
    );
  });
});
