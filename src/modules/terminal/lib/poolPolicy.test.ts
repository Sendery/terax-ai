import { describe, expect, it } from "vitest";

import {
  POOL_HARD_MAX_SIZE,
  POOL_MAX_SIZE,
  shouldGrowPool,
} from "./poolPolicy";

describe("shouldGrowPool", () => {
  it("grows freely below the soft cap", () => {
    expect(shouldGrowPool(POOL_MAX_SIZE - 1, false)).toBe(true);
  });

  it("steals an unprotected slot once the soft cap is reached", () => {
    expect(shouldGrowPool(POOL_MAX_SIZE, false)).toBe(false);
    expect(shouldGrowPool(POOL_HARD_MAX_SIZE - 1, false)).toBe(false);
  });

  it("grows instead of serializing a protected slot", () => {
    expect(shouldGrowPool(POOL_MAX_SIZE, true)).toBe(true);
    expect(shouldGrowPool(POOL_HARD_MAX_SIZE - 1, true)).toBe(true);
  });

  it("never grows past the hard cap", () => {
    expect(shouldGrowPool(POOL_HARD_MAX_SIZE, true)).toBe(false);
  });
});
