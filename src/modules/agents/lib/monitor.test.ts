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
    tone: "attention",
    read: false,
    tabTitle: "terax",
    tabColor: null,
    ...over,
  };
}

describe("projectAgentMonitor", () => {
  it("orders sessions by their latest activity when none has notified", () => {
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
          lastReason: null,
          sessionId: null,
          ptyId: null,
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
          lastReason: null,
          sessionId: null,
          ptyId: null,
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
          lastReason: null,
          sessionId: null,
          ptyId: null,
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

    expect(rows.map((row) => row.leafId)).toEqual([3, 2, 1]);
    expect(rows[2]).toMatchObject({
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
    expect(rows[0]).toMatchObject({
      state: "finished",
      stateLabel: "Waiting for prompt",
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
          lastReason: null,
          sessionId: null,
          ptyId: null,
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
          lastReason: null,
          sessionId: null,
          ptyId: null,
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
          lastReason: null,
          sessionId: null,
          ptyId: null,
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
      lastReason: null,
      sessionId: null,
      ptyId: null,
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
          lastReason: null,
          sessionId: null,
          ptyId: null,
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
          lastReason: null,
          sessionId: null,
          ptyId: null,
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
    tabLabel: null,
    state: "needs-input",
    stateLabel: "Needs input",
    reason: null,
    startedAt: new Date(2026, 0, 5, 9, 4).getTime(),
    lastActivityAt: new Date(2026, 0, 5, 11, 30).getTime(),
    lastNotificationAt: new Date(2026, 0, 5, 11, 30).getTime(),
    integrationLabel: "Native hook",
    harness: "claude",
    tabColor: null,
    task: null,
    cwd: null,
    summary: null,
    pendingQuestion: null,
    goal: null,
    tasks: [],
    taskSummary: null,
    prs: [],
    artifacts: [],
  };
  const now = new Date(2026, 0, 5, 12, 0).getTime();

  it("names the tab, the running work and the PRs when there are any", () => {
    expect(
      describeMonitorRow(
        {
          ...base,
          sessionName: "HACKATHON-MERGE",
          tabLabel: "slot-5",
          stateLabel: "Asking you",
          taskSummary: "2 subagents",
          prs: [{ number: 7, url: "u", repo: "r" }],
        },
        now,
      ),
    ).toBe(
      "HACKATHON-MERGE, tab slot-5, Claude Code, Asking you, 2 subagents, PR #7, started 09:04, last notification 30m ago",
    );
  });

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

describe("projectAgentMonitor with transcript digests", () => {
  const session = (leafId: number, patch: Record<string, unknown> = {}) => ({
    leafId,
    tabId: 10 + leafId,
    agent: "claude",
    status: "waiting" as const,
    startedAt: 10_000,
    lastActivityAt: 1_000 * leafId,
    attentionSince: null,
    lastSignal: "attention" as const,
    lastReason: null,
    sessionId: null,
    ptyId: null,
    integration: "claude-hook" as const,
    harness: "claude" as const,
    ...patch,
  });
  const digest = (patch: Record<string, unknown> = {}) => ({
    sessionId: "s",
    name: null,
    recap: null,
    recapAt: null,
    lastReply: null,
    lastReplyAt: null,
    goal: null,
    pendingQuestion: null,
    prs: [],
    artifacts: [],
    tasks: [],
    ...patch,
  });

  it("orders sessions by their latest notification", () => {
    const rows = projectAgentMonitor({
      sessions: { 1: session(1), 2: session(2), 3: session(3) },
      managed: {},
      notifications: [
        notification({ leafId: 1, at: 900 }),
        notification({ leafId: 3, at: 500 }),
      ],
    });
    // 1 notified last; 2 never notified but was active at 2000; 3 notified at 500.
    expect(rows.map((row) => row.leafId)).toEqual([2, 1, 3]);
  });

  it("shows the session's own name and keeps the tab beside it", () => {
    const [row] = projectAgentMonitor({
      sessions: { 1: session(1) },
      managed: {},
      tabs: [{ id: 11, label: "slot-5" }],
      digests: { 1: digest({ name: "HACKATHON-MERGE" }) },
    });
    expect(row).toMatchObject({
      sessionName: "HACKATHON-MERGE",
      tabLabel: "slot-5",
    });
  });

  it("does not repeat the tab when it already is the session name", () => {
    const [row] = projectAgentMonitor({
      sessions: { 1: session(1) },
      managed: {},
      tabs: [{ id: 11, label: "slot-5" }],
    });
    expect(row).toMatchObject({ sessionName: "slot-5", tabLabel: null });
  });

  it("names why the session is blocked and what it asked", () => {
    const [row] = projectAgentMonitor({
      sessions: { 1: session(1, { lastReason: "question" }) },
      managed: {},
      digests: { 1: digest({ pendingQuestion: "Which layout?" }) },
    });
    expect(row).toMatchObject({
      stateLabel: "Asking you",
      pendingQuestion: "Which layout?",
    });
  });

  it("counts only the tasks this process started", () => {
    const [row] = projectAgentMonitor({
      sessions: { 1: session(1) },
      managed: {},
      digests: {
        1: digest({
          tasks: [
            { kind: "subagent", label: "now", startedAt: 20_000 },
            { kind: "monitor", label: "before a resume", startedAt: 100 },
          ],
          prs: [{ number: 42, url: "u", repo: "r" }],
        }),
      },
    });
    expect(row.tasks.map((task) => task.label)).toEqual(["now"]);
    expect(row.taskSummary).toBe("1 subagent");
    expect(row.prs[0].number).toBe(42);
  });
});
