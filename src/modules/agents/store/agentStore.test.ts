import { beforeEach, describe, expect, it } from "vitest";
import type { SessionDigest } from "@/modules/agents/lib/types";
import {
  leafOwningPty,
  useAgentStore,
} from "@/modules/agents/store/agentStore";

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

describe("leafOwningPty", () => {
  beforeEach(() => {
    useAgentStore.setState({ sessions: {}, digests: {} });
  });

  it("names the pane whose session reads from the pty", () => {
    useAgentStore.getState().start(1, 1, "claude", "claude-hook", "claude", 41);
    useAgentStore.getState().start(2, 1, "pi", "pi-extension", "pi", 42);
    const sessions = useAgentStore.getState().sessions;
    expect(leafOwningPty(sessions, 42)).toBe(2);
    expect(leafOwningPty(sessions, 41)).toBe(1);
  });

  it("finds nothing for a pty no session recorded", () => {
    useAgentStore.getState().start(1, 1, "claude", "claude-hook", "claude");
    const sessions = useAgentStore.getState().sessions;
    expect(sessions[1]?.ptyId).toBeNull();
    expect(leafOwningPty(sessions, 7)).toBeNull();
  });

  it("lets a finished session be dropped by pty after its pane is gone", () => {
    useAgentStore.getState().start(3, 2, "claude", "claude-hook", "claude", 9);
    useAgentStore.getState().setDigest(3, digest());
    const leaf = leafOwningPty(useAgentStore.getState().sessions, 9);
    expect(leaf).toBe(3);
    useAgentStore.getState().finish(leaf as number);
    expect(useAgentStore.getState().sessions[3]).toBeUndefined();
    expect(useAgentStore.getState().digests[3]).toBeUndefined();
  });
});
