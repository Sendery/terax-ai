import type { ManagedAgent } from "../store/managedAgentsStore";
import { displayAgent, formatSessionStart, formatSince } from "./format";
import type { AgentHarness, AgentNotification, AgentSession } from "./types";
import type { TabColor } from "@/modules/tabs";

export type AgentMonitorState = "needs-input" | "working" | "finished";

export type AgentMonitorRow = {
  leafId: number;
  tabId: number;
  /** Provider id. The row shows its brand mark, not this string. */
  agent: string;
  /** What the user calls this session: the tab's visible label. */
  sessionName: string;
  state: AgentMonitorState;
  startedAt: number;
  lastActivityAt: number;
  /** Newest notification this session raised, null while it has raised none. */
  lastNotificationAt: number | null;
  integrationLabel: "Pi extension" | "Native hook" | "PTY detection";
  harness: AgentHarness;
  tabColor: TabColor | null;
  task: string | null;
  cwd: string | null;
};

export const MONITOR_STATE_LABEL: Record<AgentMonitorState, string> = {
  "needs-input": "Needs input",
  working: "Working",
  finished: "Finished",
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

function priority(state: AgentMonitorState): number {
  switch (state) {
    case "needs-input":
      return 0;
    case "working":
      return 1;
    case "finished":
      return 2;
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
}): AgentMonitorRow[] {
  const newestNotification = lastNotificationByLeaf(notifications);
  return Object.values(sessions)
    .filter((session) => !tabs.find((tab) => tab.id === session.tabId)?.private)
    .map((session) => {
      const state = stateFor(session);
      const managedAgent = managed[session.leafId];
      const tab = tabs.find((candidate) => candidate.id === session.tabId);
      return {
        leafId: session.leafId,
        tabId: session.tabId,
        agent: session.agent,
        sessionName: tab?.label?.trim() || displayAgent(session.agent),
        state,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        lastNotificationAt: newestNotification.get(session.leafId) ?? null,
        integrationLabel: integrationLabelFor(session.integration),
        harness: session.harness,
        tabColor: tab?.color ?? null,
        task: managedAgent?.task ?? null,
        cwd: managedAgent?.cwd ?? null,
      };
    })
    .sort(
      (left, right) =>
        priority(left.state) - priority(right.state) ||
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
  const parts = [
    row.sessionName,
    displayAgent(row.agent),
    MONITOR_STATE_LABEL[row.state],
  ];
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
