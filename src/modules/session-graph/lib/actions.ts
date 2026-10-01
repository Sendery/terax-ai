// What you can do from a point in the history, and what you cannot.
//
// The action set is *per agent* rather than uniform, because the two agents
// genuinely differ:
//
//   - pi persists no file snapshots at all (verified across its nine entry types
//     and its whole config directory), so a code restore is impossible there and
//     is offered only by Claude, which keeps `trackedFileBackups`;
//   - branching writes a transcript and resumes it. Claude *can* resume by id
//     from its project directory and even has `--fork-session`, so this is not
//     impossible there; it is withheld because a branched Claude file also has
//     to rewrite the per-entry `sessionId` and its bookkeeping entries, and that
//     round trip has not been verified against a real `claude --resume`.
//     Enabling it on an unverified guess would risk writing a file Claude
//     refuses to load.
//
// Nothing here mutates a live transcript. A running agent owns its file and
// holds its leaf in memory, so branching writes a *new* session instead.

import type { SessionAgent, SessionNode } from "./entries";

export type ActionId = "branch" | "resume" | "restoreCode";

export type SessionAction = {
  id: ActionId;
  label: string;
  enabled: boolean;
  /** Shown when the action is unavailable, so the gap is explained. */
  reason?: string;
  /** Extra context, such as how much a restore point covers. */
  detail?: string;
  /** True when running it changes something on disk, so it needs confirming. */
  writes: boolean;
};

/** Ids safe to interpolate into a shell command shown to the user. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function resumeCommand(agent: SessionAgent, sessionId: string): string | null {
  if (!SAFE_ID.test(sessionId)) return null;
  return agent === "pi" ? `pi --session ${sessionId}` : `claude --resume ${sessionId}`;
}

export function availableActions(
  agent: SessionAgent,
  _node: SessionNode,
  context: { codeSnapshotFiles: number },
): SessionAction[] {
  const isPi = agent === "pi";

  return [
    {
      id: "branch",
      label: "Branch from here into a new session",
      enabled: isPi,
      reason: isPi
        ? undefined
        : "Not yet verified for Claude: a branched transcript must also rewrite per-entry session ids.",
      // Writes a new file; never touches the original.
      writes: true,
    },
    {
      id: "resume",
      label: "Copy resume command",
      enabled: true,
      writes: false,
    },
    {
      id: "restoreCode",
      label: "Restore code to this point",
      enabled: !isPi && context.codeSnapshotFiles > 0,
      reason: isPi
        ? "pi records no file snapshots, so code can only be restored through git."
        : context.codeSnapshotFiles === 0
          ? "No file snapshot was taken at this point."
          : undefined,
      detail:
        !isPi && context.codeSnapshotFiles > 0
          ? `${context.codeSnapshotFiles} files`
          : undefined,
      writes: true,
    },
  ];
}
