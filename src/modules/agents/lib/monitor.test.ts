import { describe, expect, it } from "vitest";
import {
  describeMonitorRow,
  projectAgentMonitor,
  type AgentMonitorRow,
} from "./monitor";
import type { AgentNotification } from "./types";

function notification(
  over: Partial<AgentNotification> & Pick<AgentNotification, "leafId" | "at">,
): AgentNotification {
  return {
    id: `n${over.leafId}-${over.at}`,
    source: "terminal",
    tabId: 10,
    agent: "pi",
    kind: "attention",
    read: false,
    tabTitle: "terax",
    tabColor: null,
    ...over,
  };
}

describe("projectAgentMonitor", () => {
  it("prioritizes attention, then working, then recently finished sessions", () => {
    const rows = projectAgentMonitor({
      sessions: {
        1: {
          leafId: 1,
          tabId: 10,
          agent: "pi",
          status: "waiting",
          startedAt: 100,
          lastActivityAt: 300,
          attentionSince: 200,
          lastSignal: "attention",
          integration: "pi-extension",
          harness: "pi",
        },
        2: {
          leafId: 2,
          tabId: 11,
          agent: "claude",
          status: "working",
          startedAt: 100,
          lastActivityAt: 400,
          attentionSince: null,
          lastSignal: "working",
          integration: "claude-hook",
          harness: "claude",
        },
        3: {
          leafId: 3,
          tabId: 12,
          agent: "codex",
          status: "waiting",
          startedAt: 100,
          lastActivityAt: 500,
          attentionSince: null,
          lastSignal: "finished",
          integration: "pty-detection",
          harness: "codex",
        },
      },
      managed: {},
      tabs: [
        { id: 10, color: "teal" },
        { id: 11 },
        { id: 12, color: "purple" },
      ],
    });

    expect(rows.map((row) => row.leafId)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({
      state: "needs-input",
      integrationLabel: "Pi extension",
      harness: "pi",
      tabColor: "teal",
    });
    expect(rows[1]).toMatchObject({
      state: "working",
      integrationLabel: "Native hook",
      harness: "claude",
      tabColor: null,
    });
    expect(rows[2]).toMatchObject({
      state: "finished",
      integrationLabel: "PTY detection",
      harness: "codex",
      tabColor: "purple",
    });
  });

  it("omits sessions that belong to a private terminal tab", () => {
    const rows = projectAgentMonitor({
      sessions: {
        1: {
          leafId: 1,
          tabId: 10,
          agent: "pi",
          status: "working",
          startedAt: 100,
          lastActivityAt: 200,
          attentionSince: null,
          lastSignal: "working",
          integration: "pi-extension",
          harness: "pi",
        },
      },
      managed: {},
      tabs: [{ id: 10, color: "red", private: true }],
    });

    expect(rows).toEqual([]);
  });

  it("uses managed task and cwd only for an agent started by Terax", () => {
    const [row] = projectAgentMonitor({
      sessions: {
        1: {
          leafId: 1,
          tabId: 10,
          agent: "pi",
          status: "working",
          startedAt: 100,
          lastActivityAt: 200,
          attentionSince: null,
          lastSignal: "working",
          integration: "pi-extension",
          harness: "pi",
        },
      },
      managed: {
        1: {
          leafId: 1,
          tabId: 10,
          sessionId: "s1",
          task: "Add monitor",
          cwd: "/work/terax",
          rounds: 0,
          maxRounds: 3,
          phase: "working",
          reviewedAtRound: -1,
          pendingReview: false,
        },
      },
    });

    expect(row).toMatchObject({ task: "Add monitor", cwd: "/work/terax" });
  });

  it("names a row after the tab label the user sees, not the provider", () => {
    const [row] = projectAgentMonitor({
      sessions: {
        1: {
          leafId: 1,
          tabId: 10,
          agent: "claude",
          status: "working",
          startedAt: 100,
          lastActivityAt: 200,
          attentionSince: null,
          lastSignal: "working",
          integration: "claude-hook",
          harness: "claude",
        },
      },
      managed: {},
      tabs: [{ id: 10, label: "release notes" }],
    });

    expect(row).toMatchObject({ sessionName: "release notes", agent: "claude" });
  });

  it("falls back to the provider display label when the tab has no usable label", () => {
    const session = {
      leafId: 1,
      tabId: 10,
      agent: "claude",
      status: "working" as const,
      startedAt: 100,
      lastActivityAt: 200,
      attentionSince: null,
      lastSignal: "working" as const,
      integration: "claude-hook" as const,
      harness: "claude" as const,
    };

    expect(
      projectAgentMonitor({ sessions: { 1: session }, managed: {} })[0],
    ).toMatchObject({ sessionName: "Claude Code" });
    expect(
      projectAgentMonitor({
        sessions: { 1: session },
        managed: {},
        tabs: [{ id: 10, label: "   " }],
      })[0],
    ).toMatchObject({ sessionName: "Claude Code" });
  });

  it("reports the newest notification raised by each session", () => {
    const rows = projectAgentMonitor({
      sessions: {
        1: {
          leafId: 1,
          tabId: 10,
          agent: "pi",
          status: "waiting",
          startedAt: 100,
          lastActivityAt: 900,
          attentionSince: 900,
          lastSignal: "attention",
          integration: "pi-extension",
          harness: "pi",
        },
        2: {
          leafId: 2,
          tabId: 11,
          agent: "pi",
          status: "working",
          startedAt: 100,
          lastActivityAt: 800,
          attentionSince: null,
          lastSignal: "working",
          integration: "pi-extension",
          harness: "pi",
        },
      },
      managed: {},
      notifications: [
        notification({ leafId: 1, at: 400 }),
        notification({ leafId: 1, at: 750 }),
        notification({ leafId: 1, at: 600 }),
      ],
    });

    expect(rows.find((row) => row.leafId === 1)?.lastNotificationAt).toBe(750);
    expect(rows.find((row) => row.leafId === 2)?.lastNotificationAt).toBeNull();
  });
});

describe("describeMonitorRow", () => {
  const base: AgentMonitorRow = {
    leafId: 1,
    tabId: 10,
    agent: "claude",
    sessionName: "release notes",
    state: "needs-input",
    startedAt: new Date(2026, 0, 5, 9, 4).getTime(),
    lastActivityAt: new Date(2026, 0, 5, 11, 30).getTime(),
    lastNotificationAt: new Date(2026, 0, 5, 11, 30).getTime(),
    integrationLabel: "Native hook",
    harness: "claude",
    tabColor: null,
    task: null,
    cwd: null,
  };
  const now = new Date(2026, 0, 5, 12, 0).getTime();

  it("keeps every fact the row renders, plus the provider the icon stands for", () => {
    expect(describeMonitorRow(base, now)).toBe(
      "release notes, Claude Code, Needs input, started 09:04, last notification 30m ago",
    );
  });

  it("says so when a session has raised no notification yet", () => {
    expect(describeMonitorRow({ ...base, lastNotificationAt: null }, now)).toBe(
      "release notes, Claude Code, Needs input, started 09:04, no notifications yet",
    );
  });

  it("appends the managed task when Terax started the agent", () => {
    expect(describeMonitorRow({ ...base, task: "Add monitor" }, now)).toContain(
      ", Add monitor",
    );
  });
});
