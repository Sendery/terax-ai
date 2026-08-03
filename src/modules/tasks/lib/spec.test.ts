import { describe, expect, it } from "vitest";

import { formatScheduleSpec, parseScheduleSpec } from "./spec";

describe("parseScheduleSpec", () => {
  it("parses interval specs in minutes, hours and days", () => {
    expect(parseScheduleSpec("every:30m")).toEqual({
      kind: "everyN",
      minutes: 30,
    });
    expect(parseScheduleSpec("every:2h")).toEqual({
      kind: "everyN",
      minutes: 120,
    });
    expect(parseScheduleSpec("every:1d")).toEqual({
      kind: "everyN",
      minutes: 1440,
    });
    expect(parseScheduleSpec("every:45")).toEqual({
      kind: "everyN",
      minutes: 45,
    });
  });

  it("parses a daily alarm", () => {
    expect(parseScheduleSpec("daily:09:00")).toEqual({
      kind: "weekly",
      days: [0, 1, 2, 3, 4, 5, 6],
      time: "09:00",
    });
  });

  it("parses weekday names in any case and order", () => {
    expect(parseScheduleSpec("weekly:Mon,wed@07:30")).toEqual({
      kind: "weekly",
      days: [1, 3],
      time: "07:30",
    });
    expect(parseScheduleSpec("weekly:sun@23:59")).toEqual({
      kind: "weekly",
      days: [0],
      time: "23:59",
    });
  });

  it("parses weekday and weekend shorthands", () => {
    expect(parseScheduleSpec("weekly:weekdays@08:00")).toEqual({
      kind: "weekly",
      days: [1, 2, 3, 4, 5],
      time: "08:00",
    });
    expect(parseScheduleSpec("weekly:weekend@10:00")).toEqual({
      kind: "weekly",
      days: [0, 6],
      time: "10:00",
    });
  });

  it("parses an every n days spec anchored on a date", () => {
    expect(parseScheduleSpec("days:3@06:00:2026-08-01")).toEqual({
      kind: "everyNDays",
      days: 3,
      time: "06:00",
      from: "2026-08-01",
    });
  });

  it("parses specific calendar dates", () => {
    expect(parseScheduleSpec("dates:2026-08-04,2026-08-09@12:00")).toEqual({
      kind: "dates",
      dates: ["2026-08-04", "2026-08-09"],
      time: "12:00",
    });
  });

  it("parses a one shot", () => {
    const parsed = parseScheduleSpec("once:2026-08-04T09:15");
    expect(parsed?.kind).toBe("once");
    if (parsed?.kind === "once") {
      const date = new Date(parsed.at);
      expect(date.getFullYear()).toBe(2026);
      expect(date.getHours()).toBe(9);
      expect(date.getMinutes()).toBe(15);
    }
  });

  it("parses manual", () => {
    expect(parseScheduleSpec("manual")).toEqual({ kind: "manual" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseScheduleSpec("  every:30m  ")).toEqual({
      kind: "everyN",
      minutes: 30,
    });
  });

  it("rejects anything malformed rather than guessing", () => {
    const invalid = [
      "",
      "   ",
      "every",
      "every:0m",
      "every:-5m",
      "every:abc",
      "every:30x",
      "daily",
      "daily:24:00",
      "daily:9:00",
      "weekly:@08:00",
      "weekly:funday@08:00",
      "weekly:mon",
      "days:0@06:00:2026-08-01",
      "days:3@06:00",
      "days:3@06:00:not-a-date",
      "dates:@12:00",
      "dates:2026-13-40@12:00",
      "once:not-a-date",
      "cron:* * * * *",
      "hourly",
    ];
    for (const spec of invalid) {
      expect(parseScheduleSpec(spec), spec).toBeNull();
    }
  });
});

describe("formatScheduleSpec", () => {
  it("round-trips every supported kind", () => {
    const specs = [
      "manual",
      "every:30m",
      "every:2h",
      "daily:09:00",
      "weekly:mon,wed@07:30",
      "weekly:weekdays@08:00",
      "weekly:weekend@10:00",
      "days:3@06:00:2026-08-01",
      "dates:2026-08-04,2026-08-09@12:00",
    ];
    for (const spec of specs) {
      const parsed = parseScheduleSpec(spec);
      expect(parsed, spec).not.toBeNull();
      if (parsed) expect(formatScheduleSpec(parsed), spec).toBe(spec);
    }
  });

  it("formats a one shot back to a parseable spec", () => {
    const parsed = parseScheduleSpec("once:2026-08-04T09:15");
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const spec = formatScheduleSpec(parsed);
    expect(spec).toBe("once:2026-08-04T09:15");
    expect(parseScheduleSpec(spec)).toEqual(parsed);
  });

  it("prefers the minute form when hours do not divide evenly", () => {
    expect(formatScheduleSpec({ kind: "everyN", minutes: 90 })).toBe("every:90m");
  });

  it("uses the day form for a whole number of days", () => {
    expect(formatScheduleSpec({ kind: "everyN", minutes: 2880 })).toBe("every:2d");
  });
});
