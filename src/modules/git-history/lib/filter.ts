import type { GitLogEntry } from "@/modules/ai/lib/native";

/**
 * Whether a commit matches the history search box.
 *
 * Covers everything the row and its detail show: message including the body,
 * author, sha in both lengths, and the refs on it, so searching a branch name
 * finds where it points.
 */
export function commitMatches(commit: GitLogEntry, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (
    commit.subject.toLowerCase().includes(q) ||
    commit.body.toLowerCase().includes(q) ||
    commit.author.toLowerCase().includes(q) ||
    commit.authorEmail.toLowerCase().includes(q) ||
    commit.sha.toLowerCase().includes(q) ||
    commit.refs.some((ref) => ref.name.toLowerCase().includes(q))
  );
}
