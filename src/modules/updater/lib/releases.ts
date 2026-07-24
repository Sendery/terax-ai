export type UpdateChannel = "stable" | "dev";

export type GithubReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export type GithubRelease = {
  tag_name: string;
  prerelease: boolean;
  draft?: boolean;
  body?: string;
  html_url: string;
  assets?: GithubReleaseAsset[];
};

/** Operating systems reported by @tauri-apps/plugin-os `platform()`. */
export type OsKind = "macos" | "windows" | "linux";
/** CPU architectures reported by @tauri-apps/plugin-os `arch()`. */
export type ArchKind = "aarch64" | "x86_64";

export interface PlatformAsset {
  name: string;
  url: string;
}

export type Semver = {
  base: [number, number, number];
  /** Numeric pre-release ordinal (e.g. dev.3 -> 3). Absent for stable. */
  pre: number | null;
};

export function parseSemver(value: string): Semver {
  const clean = value.trim().replace(/^v/, "");
  const [core, ...preParts] = clean.split("-");
  const base = core.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const preTag = preParts.join("-");
  const preMatch = preTag.match(/(\d+)\s*$/);
  return {
    base: [base[0] ?? 0, base[1] ?? 0, base[2] ?? 0],
    pre: preTag ? (preMatch ? Number.parseInt(preMatch[1], 10) : 0) : null,
  };
}

/** Returns >0 if a is newer than b, <0 if older, 0 if equal precedence. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (x.base[i] !== y.base[i]) return x.base[i] - y.base[i];
  }
  // A stable version (pre === null) outranks any pre-release of the same base.
  if (x.pre === null && y.pre === null) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre - y.pre;
}

export function isNewerVersion(remote: string, current: string): boolean {
  return compareSemver(remote, current) > 0;
}

export function channelOf(release: GithubRelease): UpdateChannel {
  return release.prerelease ? "dev" : "stable";
}

/**
 * Pick the newest published release for a channel. Drafts are never eligible.
 * The dev channel matches pre-releases; the stable channel matches full
 * releases. Returns null when the channel has no published release.
 */
export function pickLatestRelease(
  releases: GithubRelease[],
  channel: UpdateChannel,
): GithubRelease | null {
  const eligible = releases.filter(
    (r) => r.draft !== true && channelOf(r) === channel,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, r) =>
    compareSemver(r.tag_name, best.tag_name) > 0 ? r : best,
  );
}

export function releasesApiUrl(repository: string): string {
  return `https://api.github.com/repos/${repository}/releases?per_page=100`;
}

// Filename tokens that identify each CPU architecture across installer formats.
const ARCH_TOKENS: Record<ArchKind, string[]> = {
  aarch64: ["aarch64", "arm64"],
  x86_64: ["x86_64", "x64", "amd64", "intel"],
};

function matchesArch(name: string, arch: ArchKind): boolean {
  const lower = name.toLowerCase();
  return ARCH_TOKENS[arch].some((token) => lower.includes(token));
}

// Installer formats we offer per OS, most preferred first.
const OS_SUFFIXES: Record<OsKind, string[]> = {
  macos: [".dmg"],
  windows: ["-setup.exe", ".exe", ".msi"],
  linux: [".appimage", ".deb", ".rpm"],
};

function toPlatformAsset(asset: GithubReleaseAsset): PlatformAsset {
  return { name: asset.name, url: asset.browser_download_url };
}

/**
 * Choose the most suitable downloadable installer for the running OS and CPU.
 * Prefers an architecture-specific artifact; when a macOS release exposes a
 * single universal disk image it is returned regardless of the arch token.
 * Returns null when the release has no artifact for the given platform.
 */
export function selectPlatformAsset(
  assets: GithubReleaseAsset[] | undefined,
  os: OsKind,
  arch: ArchKind,
): PlatformAsset | null {
  if (!assets || assets.length === 0) return null;
  for (const suffix of OS_SUFFIXES[os]) {
    const candidates = assets.filter((a) =>
      a.name.toLowerCase().endsWith(suffix),
    );
    if (candidates.length === 0) continue;
    const archMatch = candidates.find((a) => matchesArch(a.name, arch));
    if (archMatch) return toPlatformAsset(archMatch);
    // A single candidate with no arch token (e.g. a universal build) still wins.
    if (candidates.length === 1 && !matchesArch(candidates[0].name, other(arch))) {
      return toPlatformAsset(candidates[0]);
    }
  }
  return null;
}

function other(arch: ArchKind): ArchKind {
  return arch === "aarch64" ? "x86_64" : "aarch64";
}

// The companion Pi extension is published as a platform-independent asset on the
// same release, named `pi-terax-extension_<version>.tgz`.
export const EXTENSION_PACKAGE_NAME = "pi-terax-extension";
export const EXTENSION_ASSET_PREFIX = `${EXTENSION_PACKAGE_NAME}_`;
export const EXTENSION_ASSET_SUFFIX = ".tgz";

/** Local directory where the install snippet extracts the extension. */
export const EXTENSION_INSTALL_DIR_POSIX =
  "$HOME/.pi/extensions/pi-terax-extension";
export const EXTENSION_INSTALL_DIR_WINDOWS =
  "$HOME\\.pi\\extensions\\pi-terax-extension";

/**
 * Find the companion Pi extension tarball on a release, independent of the app
 * installer. Returns null when the release ships no extension asset.
 */
export function selectExtensionAsset(
  assets: GithubReleaseAsset[] | undefined,
): PlatformAsset | null {
  if (!assets || assets.length === 0) return null;
  const match = assets.find(
    (a) =>
      a.name.startsWith(EXTENSION_ASSET_PREFIX) &&
      a.name.endsWith(EXTENSION_ASSET_SUFFIX),
  );
  return match ? toPlatformAsset(match) : null;
}

/**
 * Public GitHub download URL for the companion extension asset on a release.
 * The extension ships in lockstep with the app, so the running app version maps
 * directly to its release asset. A leading `v` on the version is tolerated.
 */
export function extensionReleaseAssetUrl(
  repository: string,
  version: string,
): string {
  const clean = version.trim().replace(/^v/, "");
  return `https://github.com/${repository}/releases/download/v${clean}/${EXTENSION_ASSET_PREFIX}${clean}${EXTENSION_ASSET_SUFFIX}`;
}

/**
 * A single copy-pasteable install/update command for the companion extension,
 * varying by OS: a POSIX `curl` one-liner for macOS/Linux (and unknown), a
 * PowerShell one-liner for Windows. Downloads the tarball, extracts it into the
 * Pi extensions dir, installs runtime deps, and registers it with `pi install`.
 */
export function extensionInstallSnippet(
  os: OsKind | null,
  assetUrl: string,
): string {
  if (os === "windows") {
    const dest = EXTENSION_INSTALL_DIR_WINDOWS;
    const tgz = "$env:TEMP\\pi-terax-extension.tgz";
    return [
      `Invoke-WebRequest -Uri "${assetUrl}" -OutFile "${tgz}"`,
      `Remove-Item -Recurse -Force "${dest}" -ErrorAction SilentlyContinue`,
      `New-Item -ItemType Directory -Force -Path "${dest}" | Out-Null`,
      `tar -xzf "${tgz}" -C "${dest}" --strip-components=1`,
      `Push-Location "${dest}"; npm install --omit=dev; Pop-Location`,
      `pi install "${dest}"`,
    ].join("; ");
  }
  const dest = EXTENSION_INSTALL_DIR_POSIX;
  const tgz = "/tmp/pi-terax-extension.tgz";
  return [
    `curl -fsSL "${assetUrl}" -o ${tgz}`,
    `rm -rf "${dest}"`,
    `mkdir -p "${dest}"`,
    `tar -xzf ${tgz} -C "${dest}" --strip-components=1`,
    `(cd "${dest}" && npm install --omit=dev)`,
    `pi install "${dest}"`,
  ].join(" && ");
}
