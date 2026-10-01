import { describe, expect, it } from "vitest";
import { relativeCommitTime } from "./relativeTime";

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0) / 1000;
const at = (deltaSecs: number) => relativeCommitTime(NOW - deltaSecs, NOW);

describe("relativeCommitTime", () => {
  it("reads as now for the last minute", () => {
    expect(at(30)).toBe("now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(at(5 * 60)).toBe("5m");
    expect(at(3 * 3600)).toBe("3h");
    expect(at(4 * 86400)).toBe("4d");
  });

  it("switches to weeks, months and years as it ages", () => {
    expect(at(20 * 86400)).toBe("2w");
    expect(at(70 * 86400)).toBe("2mo");
    expect(at(800 * 86400)).toBe("2y");
  });

  it("says nothing for a missing timestamp", () => {
    expect(relativeCommitTime(0, NOW)).toBe("");
  });

  it("does not run into the future when a clock is skewed", () => {
    // A commit stamped ahead of the local clock is common with rebases across
    // machines; showing "-3m" would look like a bug.
    expect(relativeCommitTime(NOW + 180, NOW)).toBe("now");
  });
});
