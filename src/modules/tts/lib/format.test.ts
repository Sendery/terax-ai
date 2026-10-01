import { describe, expect, it } from "vitest";
import { formatApproxBytes, formatBytes, formatClock } from "./format";

describe("formatBytes", () => {
  it("reads as a size at every scale", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatApproxBytes(1024)).toBe("~1.0 KB");
  });

  it("does not invent a size from nonsense", () => {
    expect(formatBytes(-1)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("formatClock", () => {
  it("counts minutes and seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7)).toBe("0:07");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(600)).toBe("10:00");
  });

  it("shows 0:00 rather than NaN before the element knows the duration", () => {
    // An audio element reports NaN or Infinity until metadata has loaded.
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatClock(-3)).toBe("0:00");
  });
});
