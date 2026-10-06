import { describe, expect, it } from "vitest";

import { bellBadgeCount, bellRowView } from "./bell";
import { TONE_MARK } from "./marks";
import type { AgentNotification } from "./types";

function notification(
  over: Partial<AgentNotification> = {},
): AgentNotification {
  return {
    id: "n1",
    source: "terminal",
    leafId: 1,
    tabId: 10,
    agent: "claude",
    kind: "attention",
    tone: "permission",
    at: 0,
    read: false,
    tabTitle: "terax",
    tabColor: "blue",
    reason: "permission",
    ...over,
  };
}

describe("bellBadgeCount", () => {
  it("counts unread notifications of every kind", () => {
    expect(
      bellBadgeCount([
        notification({ id: "a" }),
        notification({ id: "b", kind: "turn-end", tone: "turn-end" }),
        notification({ id: "c", read: true }),
      ]),
    ).toBe(2);
  });

  it("drops to zero once everything is read", () => {
    expect(bellBadgeCount([notification({ read: true })])).toBe(0);
  });
});

describe("bellRowView", () => {
  it("carries the native notification's mark, body and context", () => {
    const view = bellRowView(
      notification({
        sessionName: "fix dead keys",
        text: "Claude needs your permission to use Bash",
        body: "Run pnpm test in the terminal?",
        subtitle: "terax · 2 subagents · PR #42",
      }),
    );
    expect(view).toEqual({
      mark: TONE_MARK.permission,
      name: "fix dead keys",
      label: "needs permission",
      detail: "Run pnpm test in the terminal?",
      where: "2 subagents · PR #42",
    });
  });

  it("falls back to the agent's name and words", () => {
    const view = bellRowView(
      notification({
        kind: "turn-end",
        tone: "turn-end",
        reason: undefined,
        text: "Done",
      }),
    );
    expect(view.name).toBe("Claude Code");
    expect(view.label).toBe("turn ended");
    expect(view.detail).toBe("Done");
    expect(view.where).toBeNull();
  });
});
