import type { SessionAgent } from "./entries";

export type SessionCandidate = {
  id: string;
  agent: SessionAgent;
  modifiedMs: number;
  /** Session this one was forked from, when any. */
  parentSessionId?: string | null;
};

/**
 * Chooses which transcript the panel should show for a directory.
 *
 * A live agent is the strongest signal, so a hint wins whenever that agent has
 * a transcript here. Without a hint — the agent exited, or was never detected —
 * the most recently touched transcript wins, because past history stays useful
 * after a session ends.
 */
export function pickSession(
  candidates: readonly SessionCandidate[],
  hint: SessionAgent | null,
): SessionCandidate | null {
  if (candidates.length === 0) return null;

  if (hint) {
    const hinted = candidates
      .filter((candidate) => candidate.agent === hint)
      .sort((a, b) => b.modifiedMs - a.modifiedMs);
    if (hinted.length > 0) return hinted[0];
  }

  return [...candidates].sort((a, b) => b.modifiedMs - a.modifiedMs)[0];
}
