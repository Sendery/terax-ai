import { describe, expect, it } from "vitest";

import {
  countMissedOccurrences,
  fromDateAndTime,
  isSchedule,
  MIN_INTERVAL_MINUTES,
  nextOccurrence,
  type Schedule,
  toDateInput,
  toTimeInput,
} from "./recurrence";

/** Local-time epoch builder so expectations never depend on the runner's TZ. */
function at(
  y: number,
  m: number,
  d: number,
  h = 0,
  min = 0,
): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

describe("nextOccurrence", () => {
  it("returns null for a manual schedule", () => {
    expect(nextOccurrence({ kind: "manual" }, { now: at(2026, 8, 3, 12) })).toBeNull();
  });

  it("returns the instant of a future one-shot", () => {
    const target = at(2026, 8, 4, 9, 30);
    expect(
      nextOccurrence({ kind: "once", at: target }, { now: at(2026, 8, 3, 12) }),
    ).toBe(target);
  });

  it("returns null for a one-shot that already ran", () => {
    const target = at(2026, 8, 3, 9);
    expect(
      nextOccurrence(
        { kind: "once", at: target },
        { now: at(2026, 8, 3, 12), lastRunAt: target },
      ),
    ).toBeNull();
  });

  it("fires a due one-shot that never ran", () => {
    const target = at(2026, 8, 3, 9);
    expect(
      nextOccurrence({ kind: "once", at: target }, { now: at(2026, 8, 3, 12) }),
    ).toBe(target);
  });

  it("advances an interval from the last run", () => {
    expect(
      nextOccurrence(
        { kind: "everyN", minutes: 60 },
        { now: at(2026, 8, 3, 9, 5), lastRunAt: at(2026, 8, 3, 9) },
      ),
    ).toBe(at(2026, 8, 3, 10));
  });

  it("schedules an interval that never ran one period ahead of now", () => {
    expect(
      nextOccurrence({ kind: "everyN", minutes: 15 }, { now: at(2026, 8, 3, 9) }),
    ).toBe(at(2026, 8, 3, 9, 15));
  });

  it("picks the next matching weekday and time", () => {
    // 2026-08-03 is a Monday.
    const schedule: Schedule = { kind: "weekly", days: [3, 5], time: "07:30" };
    expect(nextOccurrence(schedule, { now: at(2026, 8, 3, 12) })).toBe(
      at(2026, 8, 5, 7, 30),
    );
  });

  it("rolls a weekly schedule into the following week", () => {
    // Sunday only, evaluated on Monday.
    const schedule: Schedule = { kind: "weekly", days: [0], time: "08:00" };
    expect(nextOccurrence(schedule, { now: at(2026, 8, 3, 12) })).toBe(
      at(2026, 8, 9, 8, 0),
    );
  });

  it("fires a weekly schedule later the same day", () => {
    const schedule: Schedule = { kind: "weekly", days: [1], time: "23:00" };
    expect(nextOccurrence(schedule, { now: at(2026, 8, 3, 12) })).toBe(
      at(2026, 8, 3, 23, 0),
    );
  });

  it("keeps every-n-days aligned to its anchor date", () => {
    const schedule: Schedule = {
      kind: "everyNDays",
      days: 3,
      time: "06:00",
      from: "2026-08-01",
    };
    expect(nextOccurrence(schedule, { now: at(2026, 8, 3, 12) })).toBe(
      at(2026, 8, 4, 6, 0),
    );
  });

  it("returns the anchor itself when it is still ahead", () => {
    const schedule: Schedule = {
      kind: "everyNDays",
      days: 2,
      time: "06:00",
      from: "2026-08-10",
    };
    expect(nextOccurrence(schedule, { now: at(2026, 8, 3, 12) })).toBe(
      at(2026, 8, 10, 6, 0),
    );
  });

  it("selects the earliest future calendar date", () => {
    const schedule: Schedule = {
      kind: "dates",
      dates: ["2026-08-01", "2026-08-09", "2026-08-04"],
      time: "10:00",
    };
    expect(nextOccurrence(schedule, { now: at(2026, 8, 3, 12) })).toBe(
      at(2026, 8, 4, 10, 0),
    );
  });

  it("returns null once every calendar date has passed", () => {
    const schedule: Schedule = {
      kind: "dates",
      dates: ["2026-07-01"],
      time: "10:00",
    };
    expect(nextOccurrence(schedule, { now: at(2026, 8, 3, 12) })).toBeNull();
  });

  it("stops scheduling once maxRuns is exhausted", () => {
    expect(
      nextOccurrence(
        { kind: "everyN", minutes: 60 },
        { now: at(2026, 8, 3, 9), runCount: 5, maxRuns: 5 },
      ),
    ).toBeNull();
  });

  it("keeps scheduling when maxRuns is unlimited", () => {
    expect(
      nextOccurrence(
        { kind: "everyN", minutes: 60 },
        { now: at(2026, 8, 3, 9), runCount: 9999 },
      ),
    ).toBe(at(2026, 8, 3, 10));
  });
});

describe("countMissedOccurrences", () => {
  it("counts the hourly slots lost while Terax was closed", () => {
    expect(
      countMissedOccurrences(
        { kind: "everyN", minutes: 60 },
        { lastRunAt: at(2026, 8, 3, 9), now: at(2026, 8, 3, 12, 20) },
      ),
    ).toBe(3);
  });

  it("reports nothing missed when the cadence is still on time", () => {
    expect(
      countMissedOccurrences(
        { kind: "everyN", minutes: 60 },
        { lastRunAt: at(2026, 8, 3, 12), now: at(2026, 8, 3, 12, 20) },
      ),
    ).toBe(0);
  });

  it("counts a missed one-shot exactly once", () => {
    expect(
      countMissedOccurrences(
        { kind: "once", at: at(2026, 8, 3, 9) },
        { now: at(2026, 8, 3, 12) },
      ),
    ).toBe(1);
  });

  it("counts missed weekday slots", () => {
    expect(
      countMissedOccurrences(
        { kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" },
        { lastRunAt: at(2026, 7, 31, 8), now: at(2026, 8, 5, 12) },
      ),
    ).toBe(3);
  });

  it("never reports a missed occurrence for a manual schedule", () => {
    expect(
      countMissedOccurrences(
        { kind: "manual" },
        { lastRunAt: at(2026, 1, 1), now: at(2026, 8, 3) },
      ),
    ).toBe(0);
  });

  it("bounds the count so a long downtime cannot explode", () => {
    expect(
      countMissedOccurrences(
        { kind: "everyN", minutes: 1 },
        { lastRunAt: at(2020, 1, 1), now: at(2026, 8, 3), limit: 500 },
      ),
    ).toBe(500);
  });
});

describe("isSchedule", () => {
  it("accepts every supported kind", () => {
    const valid: unknown[] = [
      { kind: "manual" },
      { kind: "once", at: at(2026, 8, 4) },
      { kind: "everyN", minutes: 1 },
      { kind: "weekly", days: [0, 6], time: "00:00" },
      { kind: "everyNDays", days: 1, time: "23:59", from: "2026-08-01" },
      { kind: "dates", dates: ["2026-08-04"], time: "12:00" },
    ];
    for (const candidate of valid) expect(isSchedule(candidate)).toBe(true);
  });

  it("rejects an interval below the one minute floor", () => {
    expect(isSchedule({ kind: "everyN", minutes: 0 })).toBe(false);
    expect(MIN_INTERVAL_MINUTES).toBe(1);
  });

  it("rejects malformed stored values", () => {
    const invalid: unknown[] = [
      null,
      undefined,
      "manual",
      [],
      { kind: "unknown" },
      { kind: "once" },
      { kind: "once", at: Number.NaN },
      { kind: "weekly", days: [], time: "08:00" },
      { kind: "weekly", days: [7], time: "08:00" },
      { kind: "weekly", days: [1], time: "24:00" },
      { kind: "weekly", days: [1], time: "8:00" },
      { kind: "everyNDays", days: 0, time: "06:00", from: "2026-08-01" },
      { kind: "everyNDays", days: 1, time: "06:00", from: "not-a-date" },
      { kind: "dates", dates: [], time: "10:00" },
      { kind: "dates", dates: ["2026-13-40"], time: "10:00" },
    ];
    for (const candidate of invalid) expect(isSchedule(candidate)).toBe(false);
  });
});

describe("date and time inputs", () => {
  it("splits an instant into the two fields a form edits", () => {
    const instant = at(2026, 8, 4, 9, 15);
    expect(toDateInput(instant)).toBe("2026-08-04");
    expect(toTimeInput(instant)).toBe("09:15");
  });

  it("pads single digit months, days, hours and minutes", () => {
    expect(toDateInput(at(2026, 1, 2, 3, 4))).toBe("2026-01-02");
    expect(toTimeInput(at(2026, 1, 2, 3, 4))).toBe("03:04");
  });

  it("recombines the two fields into the same local instant", () => {
    const instant = at(2026, 8, 4, 9, 15);
    expect(fromDateAndTime("2026-08-04", "09:15")).toBe(instant);
  });

  it("round-trips midnight, which is the value a plain date field produces", () => {
    const midnight = at(2026, 8, 4);
    expect(fromDateAndTime(toDateInput(midnight), toTimeInput(midnight))).toBe(
      midnight,
    );
  });

  it("rejects a half typed field instead of guessing an instant", () => {
    for (const [date, time] of [
      ["", "09:15"],
      ["2026-08-04", ""],
      ["2026-8-4", "09:15"],
      ["2026-02-30", "09:15"],
      ["2026-08-04", "9:15"],
      ["2026-08-04", "24:00"],
      ["2026-08-04", "09:60"],
    ]) {
      expect(fromDateAndTime(date, time)).toBeNull();
    }
  });
});
