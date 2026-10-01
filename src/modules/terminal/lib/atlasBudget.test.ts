import { describe, expect, it } from "vitest";

import {
  ATLAS_BUDGET_BYTES,
  ATLAS_RESET_MIN_INTERVAL_MS,
  atlasBytes,
  atlasResetDelay,
} from "./atlasBudget";

describe("atlasBytes", () => {
  it("counts four bytes per pixel across every page", () => {
    expect(
      atlasBytes([
        { width: 512, height: 512 },
        { width: 1024, height: 1024 },
      ]),
    ).toBe((512 * 512 + 1024 * 1024) * 4);
  });

  it("ignores pages whose backing store was already released", () => {
    expect(
      atlasBytes([
        { width: 0, height: 0 },
        { width: 512, height: 0 },
        { width: 512, height: 512 },
      ]),
    ).toBe(512 * 512 * 4);
  });

  it("is zero without pages", () => {
    expect(atlasBytes([])).toBe(0);
  });
});

describe("atlasResetDelay", () => {
  const now = 1_000_000;

  it("leaves an atlas within budget alone", () => {
    expect(atlasResetDelay(ATLAS_BUDGET_BYTES, null, now)).toBeNull();
    expect(atlasResetDelay(1, now - 1, now)).toBeNull();
  });

  it("rebuilds an oversized atlas immediately the first time", () => {
    expect(atlasResetDelay(ATLAS_BUDGET_BYTES + 1, null, now)).toBe(0);
  });

  it("waits out the rate limit after a recent rebuild", () => {
    expect(atlasResetDelay(ATLAS_BUDGET_BYTES + 1, now - 10_000, now)).toBe(
      ATLAS_RESET_MIN_INTERVAL_MS - 10_000,
    );
  });

  it("rebuilds once the rate limit has passed", () => {
    expect(
      atlasResetDelay(
        ATLAS_BUDGET_BYTES + 1,
        now - ATLAS_RESET_MIN_INTERVAL_MS - 1,
        now,
      ),
    ).toBe(0);
  });

  it("honours an explicit budget and interval", () => {
    expect(atlasResetDelay(11, null, now, 10, 5)).toBe(0);
    expect(atlasResetDelay(11, now - 2, now, 10, 5)).toBe(3);
    expect(atlasResetDelay(10, null, now, 10, 5)).toBeNull();
  });
});
