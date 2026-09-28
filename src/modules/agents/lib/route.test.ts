import { describe, expect, it } from "vitest";
import { isDuplicate } from "./route";

describe("isDuplicate", () => {
  it("drops the second report of one block from two hooks", () => {
    // A question fires PreToolUse at once and Notification again later.
    expect(isDuplicate("terminal:1:attention:question", 1_000)).toBe(false);
    expect(isDuplicate("terminal:1:attention:question", 2_500)).toBe(true);
  });

  it("lets the same event through again once the window has passed", () => {
    expect(isDuplicate("terminal:2:turn-end:", 10_000)).toBe(false);
    expect(isDuplicate("terminal:2:turn-end:", 20_000)).toBe(false);
  });

  it("keeps panes and kinds apart", () => {
    expect(isDuplicate("terminal:3:attention:permission", 50_000)).toBe(false);
    expect(isDuplicate("terminal:4:attention:permission", 50_100)).toBe(false);
    expect(isDuplicate("terminal:3:turn-end:", 50_200)).toBe(false);
  });
});
