import { describe, expect, it } from "vitest";
import {
  describeAgentEvent,
  describeTasks,
  notificationLabel,
  sessionSummary,
} from "./describeEvent";
import type { SessionDigest } from "./types";

function digest(patch: Partial<SessionDigest> = {}): SessionDigest {
  return {
    sessionId: "s1",
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
  };
}

describe("describeAgentEvent", () => {
  it("names the session and exactly what it needs", () => {
    const d = describeAgentEvent({
      kind: "attention",
      reason: "permission",
      agentLabel: "Claude Code",
      tabTitle: "slot-5",
      text: "Claude needs your permission to use Bash",
      digest: digest({ name: "HACKATHON-MERGE" }),
    });

    expect(d.title).toBe("HACKATHON-MERGE needs permission");
    expect(d.subtitle).toBe("slot-5 · Claude Code");
    expect(d.body).toBe("Claude needs your permission to use Bash");
    expect(d.tone).toBe("permission");
  });

  it("puts the question it is blocked on in the body", () => {
    const d = describeAgentEvent({
      kind: "attention",
      reason: "question",
      agentLabel: "Claude Code",
      tabTitle: "api",
      digest: digest({ pendingQuestion: "Which layout do you prefer?" }),
    });

    expect(d.title).toBe("api is asking you");
    expect(d.body).toBe("Which layout do you prefer?");
    expect(d.tone).toBe("question");
  });

  it("says a turn ending leaves the next move to the user, with the recap", () => {
    const d = describeAgentEvent({
      kind: "turn-end",
      agentLabel: "Claude Code",
      tabTitle: "api",
      digest: digest({
        name: "PURGA",
        recap: "Freed 87 GB.",
        recapAt: 2,
        lastReplyAt: 1,
      }),
    });

    expect(d.title).toBe("PURGA finished, waiting for your prompt");
    expect(d.body).toBe("Freed 87 GB.");
    expect(d.tone).toBe("turn-end");
  });

  it("carries what is still running and the session's PR in the subtitle", () => {
    const d = describeAgentEvent({
      kind: "subagent",
      agentLabel: "Claude Code",
      tabTitle: "api",
      startedAt: 10_000,
      digest: digest({
        tasks: [
          { kind: "subagent", label: "a", startedAt: 20_000 },
          { kind: "subagent", label: "b", startedAt: 21_000 },
          { kind: "monitor", label: "m", startedAt: 22_000 },
          // Left open by a previous process in this pane: not running now.
          { kind: "background", label: "old", startedAt: 1_000 },
        ],
        prs: [{ number: 112955, url: "u", repo: "r" }],
      }),
    });

    expect(d.title).toBe("api has a subagent result");
    expect(d.subtitle).toBe(
      "Claude Code · 2 subagents, 1 monitor · PR #112955",
    );
  });

  it("falls back to the tab name, then to the agent", () => {
    expect(
      describeAgentEvent({ kind: "exited", agentLabel: "pi", tabTitle: "api" })
        .title,
    ).toBe("api exited");
    expect(
      describeAgentEvent({ kind: "exited", agentLabel: "pi", tabTitle: "" })
        .title,
    ).toBe("pi exited");
  });

  it("bounds the body to one line", () => {
    const d = describeAgentEvent({
      kind: "turn-end",
      agentLabel: "pi",
      tabTitle: "api",
      text: `first\n\nsecond ${"x".repeat(400)}`,
    });
    expect(d.body.startsWith("first second")).toBe(true);
    expect(d.body.length).toBeLessThanOrEqual(280);
  });
});

describe("sessionSummary", () => {
  it("prefers the recap only while it is the newest thing written", () => {
    expect(
      sessionSummary(
        digest({ recap: "R", recapAt: 5, lastReply: "L", lastReplyAt: 3 }),
      ),
    ).toBe("R");
    expect(
      sessionSummary(
        digest({ recap: "R", recapAt: 1, lastReply: "L", lastReplyAt: 3 }),
      ),
    ).toBe("L");
    expect(sessionSummary(digest({ lastReply: "L" }))).toBe("L");
    expect(sessionSummary(undefined)).toBeNull();
  });
});

describe("describeTasks", () => {
  it("counts each kind and says nothing when idle", () => {
    expect(describeTasks([])).toBeNull();
    expect(
      describeTasks([
        { kind: "loop", label: "", startedAt: 0 },
        { kind: "background", label: "", startedAt: 0 },
        { kind: "background", label: "", startedAt: 0 },
      ]),
    ).toBe("1 loop, 2 background jobs");
  });
});

describe("notificationLabel", () => {
  it("names the block when the hook said which one", () => {
    expect(notificationLabel("attention", "idle")).toBe(
      "is waiting for your prompt",
    );
    expect(notificationLabel("attention")).toBe("needs input");
    expect(notificationLabel("turn-end")).toBe("turn ended");
  });
});
