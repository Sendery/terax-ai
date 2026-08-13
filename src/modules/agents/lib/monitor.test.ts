import { describe, expect, it } from "vitest";
import { projectAgentMonitor } from "./monitor";

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
});
