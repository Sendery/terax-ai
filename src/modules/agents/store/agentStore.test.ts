import { beforeEach, describe, expect, it } from "vitest";
import type { SessionDigest } from "@/modules/agents/lib/types";
import { useAgentStore } from "@/modules/agents/store/agentStore";

function digest(overrides: Partial<SessionDigest> = {}): SessionDigest {
  return {
    sessionId: "s1",
    name: "Session",
    recap: null,
    recapAt: null,
    lastReply: "done",
    lastReplyAt: 10,
    goal: null,
    pendingQuestion: null,
    prs: [{ number: 7, url: "https://github.com/a/b/pull/7", repo: "a/b" }],
    artifacts: [],
    tasks: [{ kind: "subagent", label: "scan", startedAt: 5 }],
    ...overrides,
  };
}

describe("setDigest", () => {
  beforeEach(() => {
    useAgentStore.setState({ sessions: {}, digests: {} });
    useAgentStore.getState().start(1, 1, "claude", "claude-hook", "claude");
  });

  it("keeps the stored digest when a refresh reads the same content", () => {
    useAgentStore.getState().setDigest(1, digest());
    const before = useAgentStore.getState().digests;
    let notified = 0;
    const unsubscribe = useAgentStore.subscribe(() => notified++);
    useAgentStore.getState().setDigest(1, digest());
    unsubscribe();
    expect(notified).toBe(0);
    expect(useAgentStore.getState().digests).toBe(before);
  });

  it("stores a digest that changed anywhere, nested fields included", () => {
    useAgentStore.getState().setDigest(1, digest());
    useAgentStore
      .getState()
      .setDigest(
        1,
        digest({ tasks: [{ kind: "subagent", label: "scan", startedAt: 6 }] }),
      );
    expect(useAgentStore.getState().digests[1]?.tasks[0]?.startedAt).toBe(6);
    useAgentStore.getState().setDigest(1, digest({ prs: [] }));
    expect(useAgentStore.getState().digests[1]?.prs).toEqual([]);
  });

  it("ignores a digest for a pane with no session", () => {
    useAgentStore.getState().setDigest(2, digest());
    expect(useAgentStore.getState().digests[2]).toBeUndefined();
  });
});
