import { describe, expect, it } from "vitest";
import { displayAgent, formatSessionStart, formatSince } from "./format";

describe("displayAgent", () => {
  it("maps known agent ids to their display labels", () => {
    expect(displayAgent("claude")).toBe("Claude Code");
    expect(displayAgent("codex")).toBe("Codex");
    expect(displayAgent("pi")).toBe("Pi");
  });

  it("looks the label up case-insensitively", () => {
    expect(displayAgent("CLAUDE")).toBe("Claude Code");
    expect(displayAgent("gEmInI")).toBe("Gemini");
  });

  it("capitalizes an unknown agent id", () => {
    expect(displayAgent("foobar")).toBe("Foobar");
  });

  it("falls back to 'Agent' for an empty id", () => {
    expect(displayAgent("")).toBe("Agent");
  });
});

describe("formatSessionStart", () => {
  it("shows only the clock time for a session started today", () => {
    const started = new Date(2026, 0, 5, 9, 4).getTime();
    const now = new Date(2026, 0, 5, 18, 30).getTime();

    expect(formatSessionStart(started, now)).toBe("09:04");
  });

  it("prefixes the calendar day once the session predates today", () => {
    const started = new Date(2026, 0, 3, 22, 15).getTime();
    const now = new Date(2026, 0, 5, 1, 0).getTime();

    expect(formatSessionStart(started, now)).toBe("Jan 3, 22:15");
  });

  it("separates same day-of-month across different months", () => {
    const started = new Date(2025, 11, 5, 8, 0).getTime();
    const now = new Date(2026, 0, 5, 8, 0).getTime();

    expect(formatSessionStart(started, now)).toBe("Dec 5, 08:00");
  });

  it("returns an empty string when there is no usable timestamp", () => {
    expect(formatSessionStart(0, Date.now())).toBe("");
    expect(formatSessionStart(Number.NaN, Date.now())).toBe("");
  });
});

describe("formatSince", () => {
  const now = new Date(2026, 0, 5, 12, 0).getTime();

  it("reads a stamp inside the current minute as just now", () => {
    expect(formatSince(now, now)).toBe("just now");
    expect(formatSince(now - 59_000, now)).toBe("just now");
  });

  it("steps through minutes, hours and days", () => {
    expect(formatSince(now - 60_000, now)).toBe("1m ago");
    expect(formatSince(now - 59 * 60_000, now)).toBe("59m ago");
    expect(formatSince(now - 60 * 60_000, now)).toBe("1h ago");
    expect(formatSince(now - 23 * 3_600_000, now)).toBe("23h ago");
    expect(formatSince(now - 24 * 3_600_000, now)).toBe("1d ago");
    expect(formatSince(now - 9 * 24 * 3_600_000, now)).toBe("9d ago");
  });

  it("never reports a negative age when the clock runs behind the stamp", () => {
    expect(formatSince(now + 5_000, now)).toBe("just now");
  });
});
