import { describe, expect, it } from "vitest";

import {
  clampWakerInterval,
  WAKER_DEFAULT_INTERVAL_MINUTES,
  WAKER_MAX_INTERVAL_MINUTES,
  WAKER_MIN_INTERVAL_MINUTES,
  WAKER_UNAVAILABLE,
  wakerCapabilityNote,
  type WakerStatus,
} from "./waker";

function status(overrides: Partial<WakerStatus> = {}): WakerStatus {
  return {
    installed: true,
    intervalMinutes: 15,
    canWakeSystem: false,
    supported: true,
    path: "/tmp/unit",
    ...overrides,
  };
}

describe("clampWakerInterval", () => {
  it("keeps a sensible cadence inside the supported band", () => {
    expect(clampWakerInterval(15)).toBe(15);
    expect(clampWakerInterval(WAKER_MIN_INTERVAL_MINUTES)).toBe(1);
    expect(clampWakerInterval(WAKER_MAX_INTERVAL_MINUTES)).toBe(180);
  });

  it("allows a one minute cadence so the path can be validated quickly", () => {
    expect(WAKER_MIN_INTERVAL_MINUTES).toBe(1);
    expect(clampWakerInterval(1)).toBe(1);
  });

  it("clamps rather than rejecting an out of range cadence", () => {
    expect(clampWakerInterval(0)).toBe(1);
    expect(clampWakerInterval(-30)).toBe(1);
    expect(clampWakerInterval(10_000)).toBe(180);
  });

  it("rounds a fractional cadence", () => {
    expect(clampWakerInterval(14.6)).toBe(15);
  });

  it("falls back to the default for a value that is not a number", () => {
    expect(clampWakerInterval(Number.NaN)).toBe(WAKER_DEFAULT_INTERVAL_MINUTES);
    expect(clampWakerInterval(Number.POSITIVE_INFINITY)).toBe(
      WAKER_DEFAULT_INTERVAL_MINUTES,
    );
  });

  it("defaults to fifteen minutes", () => {
    expect(WAKER_DEFAULT_INTERVAL_MINUTES).toBe(15);
  });
});

describe("wakerCapabilityNote", () => {
  it("says so plainly where the platform has no waker", () => {
    expect(wakerCapabilityNote(status({ supported: false }))).toBe(
      "Not available on this platform.",
    );
    expect(wakerCapabilityNote(WAKER_UNAVAILABLE)).toBe(
      "Not available on this platform.",
    );
  });

  it("promises a machine wake only where that is unprivileged", () => {
    expect(wakerCapabilityNote(status({ canWakeSystem: true }))).toContain(
      "wake the computer",
    );
  });

  it("never implies a machine wake where it needs privileges", () => {
    const note = wakerCapabilityNote(status({ canWakeSystem: false }));
    expect(note).toContain("Cannot wake the computer");
    expect(note).toContain("next time it wakes");
  });
});

describe("WAKER_UNAVAILABLE", () => {
  it("is a safe default that claims nothing", () => {
    expect(WAKER_UNAVAILABLE.installed).toBe(false);
    expect(WAKER_UNAVAILABLE.supported).toBe(false);
    expect(WAKER_UNAVAILABLE.canWakeSystem).toBe(false);
  });
});
