import { describe, expect, it } from "vitest";

import { needsAtlasClear } from "./atlasRepaint";

describe("needsAtlasClear", () => {
  it("skips the clear when every target gets a fresh renderer", () => {
    expect(needsAtlasClear([{ hasWebgl: false }, { hasWebgl: false }])).toBe(
      false,
    );
  });

  it("clears when any target kept an existing context", () => {
    expect(needsAtlasClear([{ hasWebgl: false }, { hasWebgl: true }])).toBe(
      true,
    );
  });

  it("does nothing without targets", () => {
    expect(needsAtlasClear([])).toBe(false);
  });
});
