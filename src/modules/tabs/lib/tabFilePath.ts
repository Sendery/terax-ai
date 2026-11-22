import type { Tab } from "./useTabs";

const ABSOLUTE = /^(?:[\\/]|[A-Za-z]:[\\/])/;

/** A repository-relative path made absolute, in the root's separator style. */
export function joinRepoPath(repoRoot: string, path: string): string {
  if (ABSOLUTE.test(path)) return path;
  const sep = repoRoot.includes("\\") && !repoRoot.includes("/") ? "\\" : "/";
  const root = repoRoot.replace(/[\\/]+$/, "");
  return `${root}${sep}${path.replace(/[\\/]/g, sep)}`;
}

/** The absolute path of the file a tab shows, or null when it shows none. */
export function tabFilePath(tab: Tab): string | null {
  switch (tab.kind) {
    case "editor":
    case "markdown":
    case "ai-diff":
      return tab.path || null;
    case "git-diff":
    case "git-commit-file":
      return tab.path ? joinRepoPath(tab.repoRoot, tab.path) : null;
    default:
      return null;
  }
}
