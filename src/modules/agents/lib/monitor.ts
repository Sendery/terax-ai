import type { ManagedAgent } from "../store/managedAgentsStore";
import type { AgentHarness, AgentSession } from "./types";
import type { TabColor } from "@/modules/tabs";

export type AgentMonitorState = "needs-input" | "working" | "finished";

export type AgentMonitorRow = {
  leafId: number;
  tabId: number;
  agent: string;
  state: AgentMonitorState;
  startedAt: number;
  lastActivityAt: number;
  integrationLabel: "Pi extension" | "Native hook" | "PTY detection";
  harness: AgentHarness;
  tabColor: TabColor | null;
  task: string | null;
  cwd: string | null;
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

export function projectAgentMonitor({
  sessions,
  managed,
  tabs = [],
}: {
  sessions: Record<number, MonitorSession>;
  managed: Record<number, ManagedAgent>;
  tabs?: readonly { id: number; color?: TabColor; private?: boolean }[];
}): AgentMonitorRow[] {
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
        state,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
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
