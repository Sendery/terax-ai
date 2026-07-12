export type BuildChannel = "development" | "official";

export interface BuildInfo {
  repository: string;
  branch: string;
  commit: string;
  builtAt: string;
  channel: BuildChannel;
}

const FALLBACK_BUILD_INFO: BuildInfo = {
  repository: "Sendery/terax-ai",
  branch: "unknown",
  commit: "unknown",
  builtAt: "unknown",
  channel: "development",
};

export const BUILD_INFO: BuildInfo =
  typeof __TERAX_BUILD_INFO__ === "undefined"
    ? FALLBACK_BUILD_INFO
    : __TERAX_BUILD_INFO__;

export function buildChannelLabel(channel: BuildChannel): string {
  return channel === "official" ? "Official" : "Development";
}

export function shortCommit(commit: string): string {
  return commit === "unknown" ? commit : commit.slice(0, 7);
}

export function buildCommitUrl(repository: string, commit: string): string {
  return `https://github.com/${repository}/commit/${commit}`;
}

export function formatBuildDate(
  value: string,
  locale: string | string[] = "en-GB",
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}
