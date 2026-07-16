export type UpdateChannel = "stable" | "dev";

export type GithubRelease = {
  tag_name: string;
  prerelease: boolean;
  draft?: boolean;
  body?: string;
  html_url: string;
};

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
