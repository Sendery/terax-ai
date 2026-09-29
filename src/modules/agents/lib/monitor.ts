import type { ManagedAgent } from "../store/managedAgentsStore";
import { describeTasks, liveTasks, sessionSummary } from "./describeEvent";
import { displayAgent, formatSessionStart, formatSince } from "./format";
import type {
  AgentHarness,
  AgentNotification,
  AgentSession,
  AttentionReason,
  SessionDigest,
} from "./types";
import type { TabColor } from "@/modules/tabs";

export type AgentMonitorState = "needs-input" | "working" | "finished";

export type AgentMonitorRow = {
  leafId: number;
  tabId: number;
  /** Provider id. The row shows its brand mark, not this string. */
  agent: string;
  /** The session's own name when its transcript has one, else the tab's label. */
  sessionName: string;
  /** The tab's label, shown beside the session name whenever the two differ. */
  tabLabel: string | null;
  state: AgentMonitorState;
  /** The state as the row reads it, naming the block when the hook said which. */
  stateLabel: string;
  reason: AttentionReason | null;
  startedAt: number;
  lastActivityAt: number;
  /** Newest notification this session raised, null while it has raised none. */
  lastNotificationAt: number | null;
  integrationLabel: "Pi extension" | "Native hook" | "PTY detection";
  harness: AgentHarness;
  tabColor: TabColor | null;
  task: string | null;
  cwd: string | null;
  /** The agent's latest recap or reply, for the hover card. */
  summary: string | null;
  pendingQuestion: string | null;
  goal: string | null;
  /** Work still running under the current process, counted for the row. */
  tasks: SessionDigest["tasks"];
  taskSummary: string | null;
  prs: SessionDigest["prs"];
  artifacts: SessionDigest["artifacts"];
};

const MONITOR_STATE_LABEL: Record<AgentMonitorState, string> = {
  "needs-input": "Needs input",
  working: "Working",
  finished: "Waiting for prompt",
};

const REASON_STATE_LABEL: Record<AttentionReason, string> = {
  permission: "Needs permission",
  question: "Asking you",
  idle: "Waiting for prompt",
};

type MonitorSession = AgentSession & {
  integration: "pi-extension" | "claude-hook" | "pty-detection";
};

function stateFor(session: MonitorSession): AgentMonitorState {
  if (session.status === "working") return "working";
  return session.lastSignal === "finished" ? "finished" : "needs-input";
}

function integrationLabelFor(
  integration: MonitorSession["integration"],
): AgentMonitorRow["integrationLabel"] {
  switch (integration) {
    case "pi-extension":
      return "Pi extension";
    case "claude-hook":
      return "Native hook";
    case "pty-detection":
      return "PTY detection";
  }
}

/**
 * Newest notification per leaf.
 *
 * The store keeps notifications newest-first and bounded, but order is a
 * rendering convenience rather than a guarantee, so take the maximum instead of
 * trusting the first match.
 */
function lastNotificationByLeaf(
  notifications: readonly AgentNotification[],
): Map<number, number> {
  const newest = new Map<number, number>();
  for (const notification of notifications) {
    const seen = newest.get(notification.leafId);
    if (seen === undefined || notification.at > seen) {
      newest.set(notification.leafId, notification.at);
    }
  }
  return newest;
}

export function projectAgentMonitor({
  sessions,
  managed,
  tabs = [],
  notifications = [],
  digests = {},
}: {
  sessions: Record<number, MonitorSession>;
  managed: Record<number, ManagedAgent>;
  /**
   * `label` is the tab's resolved visible name. The caller resolves it, so this
   * projection stays free of the tab module's labelling rules.
   */
  tabs?: readonly {
    id: number;
    color?: TabColor;
    private?: boolean;
    label?: string;
  }[];
  notifications?: readonly AgentNotification[];
  digests?: Record<number, SessionDigest>;
}): AgentMonitorRow[] {
  const newestNotification = lastNotificationByLeaf(notifications);
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  return Object.values(sessions)
    .filter((session) => !tabById.get(session.tabId)?.private)
    .map((session): AgentMonitorRow => {
      const state = stateFor(session);
      const managedAgent = managed[session.leafId];
      const tab = tabById.get(session.tabId);
      const digest = digests[session.leafId];
      const tabLabel = tab?.label?.trim() || null;
      const sessionName =
        digest?.name?.trim() || tabLabel || displayAgent(session.agent);
      const reason = state === "needs-input" ? session.lastReason : null;
      const tasks = digest ? liveTasks(digest.tasks, session.startedAt) : [];
      return {
        leafId: session.leafId,
        tabId: session.tabId,
        agent: session.agent,
        sessionName,
        tabLabel: tabLabel && tabLabel !== sessionName ? tabLabel : null,
        state,
        stateLabel: reason
          ? REASON_STATE_LABEL[reason]
          : MONITOR_STATE_LABEL[state],
        reason,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        lastNotificationAt: newestNotification.get(session.leafId) ?? null,
        integrationLabel: integrationLabelFor(session.integration),
        harness: session.harness,
        tabColor: tab?.color ?? null,
        task: managedAgent?.task ?? null,
        cwd: managedAgent?.cwd ?? null,
        summary: sessionSummary(digest),
        pendingQuestion:
          reason === "question" ? (digest?.pendingQuestion ?? null) : null,
        goal: digest?.goal ?? null,
        tasks,
        taskSummary: describeTasks(tasks),
        prs: digest?.prs ?? [],
        artifacts: digest?.artifacts ?? [],
      };
    })
    .sort(
      (left, right) =>
        (right.lastNotificationAt ?? right.lastActivityAt) -
          (left.lastNotificationAt ?? left.lastActivityAt) ||
        right.lastActivityAt - left.lastActivityAt,
    );
}

/**
 * The accessible name of one monitor row.
 *
 * The row's own label is the session name, and the provider is carried only by
 * the brand mark, so an accessible name built from the visible text alone would
 * drop the provider, the state dot, and both timestamps. Compose them here
 * instead, and keep the order the row reads in.
 */
export function describeMonitorRow(row: AgentMonitorRow, now: number): string {
  const parts = [row.sessionName];
  if (row.tabLabel) parts.push(`tab ${row.tabLabel}`);
  parts.push(displayAgent(row.agent), row.stateLabel);
  if (row.taskSummary) parts.push(row.taskSummary);
  if (row.prs.length > 0) {
    parts.push(row.prs.map((pr) => `PR #${pr.number}`).join(" "));
  }
  const started = formatSessionStart(row.startedAt, now);
  if (started) parts.push(`started ${started}`);
  parts.push(
    row.lastNotificationAt === null
      ? "no notifications yet"
      : `last notification ${formatSince(row.lastNotificationAt, now)}`,
  );
  if (row.task) parts.push(row.task);
  return parts.join(", ");
}
