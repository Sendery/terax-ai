import { describe, expect, it } from "vitest";

import { TONE_MARK } from "@/modules/agents/lib/marks";
import { tabStateMark } from "./agentMark";

describe("tabStateMark", () => {
  it("uses the notification's mark for each attention cause", () => {
    expect(
      tabStateMark({ top: "attention", count: 1, reason: "permission" }),
    ).toBe(TONE_MARK.permission);
    expect(
      tabStateMark({ top: "attention", count: 1, reason: "question" }),
    ).toBe(TONE_MARK.question);
    expect(tabStateMark({ top: "attention", count: 1, reason: "idle" })).toBe(
      TONE_MARK.idle,
    );
    expect(tabStateMark({ top: "attention", count: 2, reason: null })).toBe(
      TONE_MARK.attention,
    );
  });

  it("marks a finished turn like the turn-end notification", () => {
    expect(tabStateMark({ top: "finished", count: 1, reason: null })).toBe(
      TONE_MARK["turn-end"],
    );
  });

  it("leaves working and idle tabs without a mark", () => {
    expect(tabStateMark({ top: "working", count: 1, reason: null })).toBeNull();
    expect(tabStateMark({ top: null, count: 0, reason: null })).toBeNull();
  });
});
