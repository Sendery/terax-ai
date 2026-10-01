import { isTaskAgent, type TaskAgent } from "@/modules/tasks/lib/agents";
import {
  recoverCommandLine,
  type ShellFlavor,
} from "@/modules/tasks/lib/dispatch";
import { isTabColor, type TabColor } from "@/modules/tabs";

/**
 * Agent CLIs whose conversation survives the process that ran it, so reopening
 * Terax can offer to pick it back up. It is deliberately the same set the
 * scheduler drives: the resume spelling per CLI has exactly one owner
 * (`recoverCommandLine`), and a second copy of that knowledge would drift.
 */
export type RestorableAgent = TaskAgent;

export type SavedAgentSession = {
  agent: RestorableAgent;
  /** Directory the agent was running in. Also how codex finds its own session. */
  cwd: string;
  spaceId: string;
  /**
   * Transcript the CLI wrote. Absent only for codex, which mints its own ids
   * and offers nothing but "the most recent session in this directory".
   */
  sessionId?: string;
  /**
   * Position of the tab within its space, so a restore lands back in the tab
   * the space serializer already recreated instead of duplicating it.
   */
  tabIndex: number;
  /**
   * Position of the pane within that tab's leaves, in tree order. A tab can
   * hold several agents at once, and reopening all of them into the active
   * pane would collapse them onto one shell. Absent in snapshots written
   * before panes were recorded.
   */
  leafIndex?: number;
  tabTitle: string;
  tabColor?: TabColor;
  startedAt: number;
};

export type AgentRestoreSnapshot = {
  version: 1;
  savedAt: number;
  sessions: SavedAgentSession[];
};

export const RESTORE_SNAPSHOT_VERSION = 1;

/**
 * Ceiling on how many sessions one snapshot carries. Each restored session
 * costs a PTY plus a renderer slot, so an unbounded list would let a stored
 * file decide how much memory the next launch spends.
 */
export const MAX_RESTORABLE_SESSIONS = 25;

const MAX_TITLE_CHARS = 80;

/**
 * Mirrors `is_safe_session_id` in Rust, minus a leading dash: this id is
 * substituted into a shell command line, where `--anything` would be read by
 * the CLI as a flag rather than as the session to resume.
 */
const SESSION_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/;

export function isRestorableSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_RE.test(value);
}

/**
 * A saved session is only kept when it can actually be reopened. pi and claude
 * name their sessions, so an entry without an id would resume nothing; codex
 * has no id to record and resumes by directory.
 */
export function isSavedAgentSession(
  value: unknown,
): value is SavedAgentSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  if (!isTaskAgent(s.agent)) return false;
  if (typeof s.cwd !== "string" || s.cwd === "") return false;
  if (typeof s.spaceId !== "string" || s.spaceId === "") return false;
  if (typeof s.tabTitle !== "string") return false;
  if (
    typeof s.tabIndex !== "number" ||
    !Number.isInteger(s.tabIndex) ||
    s.tabIndex < 0
  ) {
    return false;
  }
  if (
    s.leafIndex !== undefined &&
    (typeof s.leafIndex !== "number" ||
      !Number.isInteger(s.leafIndex) ||
      s.leafIndex < 0)
  ) {
    return false;
  }
  if (
    typeof s.startedAt !== "number" ||
    !Number.isFinite(s.startedAt) ||
    s.startedAt <= 0
  ) {
    return false;
  }
  if (s.tabColor !== undefined && !isTabColor(s.tabColor)) return false;
  if (s.agent === "codex") return s.sessionId === undefined;
  return isRestorableSessionId(s.sessionId);
}

function normalize(session: SavedAgentSession): SavedAgentSession {
  return {
    agent: session.agent,
    cwd: session.cwd,
    spaceId: session.spaceId,
    ...(session.sessionId !== undefined && { sessionId: session.sessionId }),
    tabIndex: session.tabIndex,
    ...(session.leafIndex !== undefined && { leafIndex: session.leafIndex }),
    tabTitle: session.tabTitle.slice(0, MAX_TITLE_CHARS),
    ...(session.tabColor !== undefined && { tabColor: session.tabColor }),
    startedAt: session.startedAt,
  };
}

/** Identity of a session for de-duplication: what would be reopened, not where. */
function key(session: SavedAgentSession): string {
  return `${session.agent}\u0000${session.cwd}\u0000${session.sessionId ?? ""}`;
}

/**
 * The snapshot written while agents are live. Deduplicated because two leaves
 * in the same directory can resolve to the same codex session, and reopening it
 * twice would start two agents on one transcript.
 */
export function buildRestoreSnapshot(
  candidates: readonly SavedAgentSession[],
  now: number,
): AgentRestoreSnapshot {
  const seen = new Set<string>();
  const sessions: SavedAgentSession[] = [];
  for (const candidate of candidates) {
    if (!isSavedAgentSession(candidate)) continue;
    const id = key(candidate);
    if (seen.has(id)) continue;
    seen.add(id);
    sessions.push(normalize(candidate));
    if (sessions.length === MAX_RESTORABLE_SESSIONS) break;
  }
  return { version: RESTORE_SNAPSHOT_VERSION, savedAt: now, sessions };
}

/** Reads a stored snapshot, dropping entries that could not be reopened. */
export function parseRestoreSnapshot(
  value: unknown,
): AgentRestoreSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== RESTORE_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(raw.sessions)) return null;
  const savedAt =
    typeof raw.savedAt === "number" && Number.isFinite(raw.savedAt)
      ? raw.savedAt
      : 0;
  const snapshot = buildRestoreSnapshot(
    raw.sessions.filter(isSavedAgentSession),
    savedAt,
  );
  return snapshot.sessions.length ? snapshot : null;
}

/**
 * Command that reopens one saved session in a shell already sitting in its
 * directory. The `cd` `recoverCommandLine` prepends is kept on purpose: a
 * restored tab whose directory no longer resolves would otherwise resume the
 * agent against whatever the shell fell back to.
 */
export function resumeCommandLine(
  session: SavedAgentSession,
  flavor: ShellFlavor,
): string {
  return recoverCommandLine(
    {
      cwd: session.cwd,
      // Only codex reaches here without an id, and codex ignores it.
      sessionId: session.sessionId ?? "",
      agent: session.agent,
    },
    flavor,
  );
}

export type RestoreCandidateLeaf = {
  id: number;
  /** Directory this pane was left in, as the space serializer recorded it. */
  cwd?: string;
};

export type RestoreCandidateTab = {
  id: number;
  kind: string;
  spaceId: string;
  /** Panes in tree order, which is the order leafIndex was recorded against. */
  leaves: readonly RestoreCandidateLeaf[];
};

export type RestoreTarget = {
  session: SavedAgentSession;
  /** Tab the space serializer already restored, or null to open a new one. */
  tabId: number | null;
  /** Pane inside that tab to resume into, or null to use its active one. */
  leafId: number | null;
};

type Candidate = {
  tab: RestoreCandidateTab;
  leaf: RestoreCandidateLeaf;
};

/**
 * Pairs each saved session with the pane it was running in.
 *
 * The space serializer restores the terminal tab itself, so resuming into a new
 * tab would leave the user with an idle duplicate of every agent tab. Ids are
 * minted fresh on every launch, so the pairing is positional: the pane at the
 * recorded index of the tab at the recorded index within its space, and only
 * when that pane's directory still agrees.
 *
 * The unit is the pane rather than the tab because one tab can hold several
 * agents in a split, and matching by tab would send the second agent to a new
 * tab while its own shell sat there empty. A pane is claimed at most once, so
 * two sessions never resume into one shell.
 */
export function matchRestoreTargets(
  sessions: readonly SavedAgentSession[],
  tabs: readonly RestoreCandidateTab[],
): RestoreTarget[] {
  const bySpace = new Map<string, RestoreCandidateTab[]>();
  for (const tab of tabs) {
    const list = bySpace.get(tab.spaceId);
    if (list) list.push(tab);
    else bySpace.set(tab.spaceId, [tab]);
  }
  const claimed = new Set<number>();

  return sessions.map((session) => {
    const inSpace = bySpace.get(session.spaceId) ?? [];
    const usable = (
      tab: RestoreCandidateTab | undefined,
      leaf: RestoreCandidateLeaf | undefined,
    ): leaf is RestoreCandidateLeaf =>
      tab !== undefined &&
      leaf !== undefined &&
      tab.kind === "terminal" &&
      leaf.cwd === session.cwd &&
      !claimed.has(leaf.id);

    const match = firstMatch(inSpace, session, usable);
    if (!match) return { session, tabId: null, leafId: null };
    claimed.add(match.leaf.id);
    return { session, tabId: match.tab.id, leafId: match.leaf.id };
  });
}

/**
 * The recorded position first, then any free pane whose directory agrees.
 * Falling back matters more than being exact: a tab added or closed since the
 * snapshot shifts every index after it, and resuming into the right shell one
 * position over still beats opening a duplicate tab.
 */
function firstMatch(
  inSpace: readonly RestoreCandidateTab[],
  session: SavedAgentSession,
  usable: (
    tab: RestoreCandidateTab | undefined,
    leaf: RestoreCandidateLeaf | undefined,
  ) => leaf is RestoreCandidateLeaf,
): Candidate | null {
  const recordedTab = inSpace[session.tabIndex];
  if (recordedTab) {
    const recordedLeaf = recordedTab.leaves[session.leafIndex ?? 0];
    if (usable(recordedTab, recordedLeaf)) {
      return { tab: recordedTab, leaf: recordedLeaf };
    }
    const sibling = recordedTab.leaves.find((leaf) =>
      usable(recordedTab, leaf),
    );
    if (sibling) return { tab: recordedTab, leaf: sibling };
  }
  for (const tab of inSpace) {
    const leaf = tab.leaves.find((candidate) => usable(tab, candidate));
    if (leaf) return { tab, leaf };
  }
  return null;
}

/** One-line description of what reopening an entry would do. */
export function describeSavedSession(session: SavedAgentSession): string {
  return session.sessionId
    ? `${session.cwd} · session ${session.sessionId.slice(0, 8)}`
    : `${session.cwd} · most recent session`;
}

/**
 * Picks which transcript belongs to a live agent, given the ids that already
 * existed in its directory when it started and the ids other live leaves have
 * taken.
 *
 * A brand new session is the newest id that was not there before, but an agent
 * launched as `claude --resume <id>` keeps writing to a file that *was* there,
 * so the pre-existing ids are only a preference and never a filter. Ids already
 * claimed are excluded outright: two agents in one directory must not resolve
 * to one transcript.
 */
export function claimSessionId({
  listed,
  before,
  claimed,
}: {
  /** Session ids for the directory, most recently written first. */
  listed: readonly string[];
  before: ReadonlySet<string>;
  claimed: ReadonlySet<string>;
}): string | null {
  const free = listed.filter(
    (id) => !claimed.has(id) && isRestorableSessionId(id),
  );
  return free.find((id) => !before.has(id)) ?? free[0] ?? null;
}
