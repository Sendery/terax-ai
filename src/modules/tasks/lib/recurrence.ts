export const MIN_INTERVAL_MINUTES = 1;
const MISSED_LIMIT_DEFAULT = 1000;
const DAY_MS = 86_400_000;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Schedule =
  | { kind: "manual" }
  | { kind: "once"; at: number }
  | { kind: "everyN"; minutes: number }
  | { kind: "weekly"; days: Weekday[]; time: string }
  | { kind: "everyNDays"; days: number; time: string; from: string }
  | { kind: "dates"; dates: string[]; time: string };

export type ScheduleKind = Schedule["kind"];

export type OccurrenceContext = {
  now: number;
  lastRunAt?: number;
  runCount?: number;
  maxRuns?: number;
};

export type MissedContext = {
  now: number;
  lastRunAt?: number;
  limit?: number;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseTime(time: string): { hour: number; minute: number } | null {
  const match = TIME_RE.exec(time);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function parseDate(
  date: string,
): { year: number; month: number; day: number } | null {
  const match = DATE_RE.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Local wall-clock instant. Calendar schedules must follow the user's clock
 *  across DST, so day stepping uses Date field arithmetic and never fixed ms. */
function instantOn(
  year: number,
  month: number,
  day: number,
  time: { hour: number; minute: number },
): number {
  return new Date(year, month - 1, day, time.hour, time.minute, 0, 0).getTime();
}

function startOfDay(value: number): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWeekday(value: unknown): value is Weekday {
  return isFiniteInteger(value) && value >= 0 && value <= 6;
}

export function isSchedule(value: unknown): value is Schedule {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "manual":
      return true;
    case "once":
      return typeof value.at === "number" && Number.isFinite(value.at);
    case "everyN":
      return (
        isFiniteInteger(value.minutes) && value.minutes >= MIN_INTERVAL_MINUTES
      );
    case "weekly":
      return (
        Array.isArray(value.days) &&
        value.days.length > 0 &&
        value.days.every(isWeekday) &&
        typeof value.time === "string" &&
        parseTime(value.time) !== null
      );
    case "everyNDays":
      return (
        isFiniteInteger(value.days) &&
        value.days >= 1 &&
        typeof value.time === "string" &&
        parseTime(value.time) !== null &&
        typeof value.from === "string" &&
        parseDate(value.from) !== null
      );
    case "dates":
      return (
        Array.isArray(value.dates) &&
        value.dates.length > 0 &&
        value.dates.every((d) => typeof d === "string" && parseDate(d) !== null) &&
        typeof value.time === "string" &&
        parseTime(value.time) !== null
      );
    default:
      return false;
  }
}

function isExhausted(ctx: OccurrenceContext): boolean {
  return (
    typeof ctx.maxRuns === "number" &&
    ctx.maxRuns > 0 &&
    (ctx.runCount ?? 0) >= ctx.maxRuns
  );
}

function nextWeekly(
  schedule: Extract<Schedule, { kind: "weekly" }>,
  now: number,
): number | null {
  const time = parseTime(schedule.time);
  if (!time) return null;
  const cursor = startOfDay(now);
  for (let step = 0; step <= 7; step += 1) {
    if (schedule.days.includes(cursor.getDay() as Weekday)) {
      const candidate = instantOn(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        cursor.getDate(),
        time,
      );
      if (candidate > now) return candidate;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

function nextEveryNDays(
  schedule: Extract<Schedule, { kind: "everyNDays" }>,
  now: number,
): number | null {
  const time = parseTime(schedule.time);
  const anchor = parseDate(schedule.from);
  if (!time || !anchor) return null;
  const anchorMs = instantOn(anchor.year, anchor.month, anchor.day, time);
  if (anchorMs > now) return anchorMs;
  const periodMs = schedule.days * DAY_MS;
  const skipped = Math.max(0, Math.floor((now - anchorMs) / periodMs));
  const cursor = new Date(anchorMs);
  cursor.setDate(cursor.getDate() + skipped * schedule.days);
  for (let guard = 0; guard <= 2; guard += 1) {
    const candidate = instantOn(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      cursor.getDate(),
      time,
    );
    if (candidate > now) return candidate;
    cursor.setDate(cursor.getDate() + schedule.days);
  }
  return null;
}

function nextDates(
  schedule: Extract<Schedule, { kind: "dates" }>,
  now: number,
): number | null {
  const time = parseTime(schedule.time);
  if (!time) return null;
  let best: number | null = null;
  for (const raw of schedule.dates) {
    const date = parseDate(raw);
    if (!date) continue;
    const candidate = instantOn(date.year, date.month, date.day, time);
    if (candidate > now && (best === null || candidate < best)) best = candidate;
  }
  return best;
}

/**
 * Next instant the task should fire, or null when nothing is pending. A value in
 * the past means the task is overdue and the dispatcher must fire it now.
 */
export function nextOccurrence(
  schedule: Schedule,
  ctx: OccurrenceContext,
): number | null {
  if (isExhausted(ctx)) return null;
  switch (schedule.kind) {
    case "manual":
      return null;
    case "once":
      if (ctx.lastRunAt !== undefined && ctx.lastRunAt >= schedule.at) {
        return null;
      }
      return schedule.at;
    case "everyN": {
      const periodMs = schedule.minutes * 60_000;
      return (ctx.lastRunAt ?? ctx.now) + periodMs;
    }
    case "weekly":
      return nextWeekly(schedule, ctx.now);
    case "everyNDays":
      return nextEveryNDays(schedule, ctx.now);
    case "dates":
      return nextDates(schedule, ctx.now);
  }
}

/**
 * Occurrences strictly after `lastRunAt` and no later than `now`, used to size
 * the downtime recovery decision. Bounded so a long outage cannot explode.
 */
export function countMissedOccurrences(
  schedule: Schedule,
  ctx: MissedContext,
): number {
  const limit = ctx.limit ?? MISSED_LIMIT_DEFAULT;
  if (limit <= 0) return 0;
  switch (schedule.kind) {
    case "manual":
      return 0;
    case "once": {
      const pending =
        schedule.at <= ctx.now &&
        (ctx.lastRunAt === undefined || ctx.lastRunAt < schedule.at);
      return pending ? 1 : 0;
    }
    case "everyN": {
      if (ctx.lastRunAt === undefined) return 0;
      const periodMs = schedule.minutes * 60_000;
      const elapsed = ctx.now - ctx.lastRunAt;
      if (elapsed <= 0) return 0;
      return Math.min(limit, Math.floor(elapsed / periodMs));
    }
    default:
      return countCalendarMissed(schedule, ctx, limit);
  }
}

function countCalendarMissed(
  schedule: Schedule,
  ctx: MissedContext,
  limit: number,
): number {
  const after = ctx.lastRunAt;
  if (after === undefined) return 0;
  let cursor = after;
  let count = 0;
  while (count < limit) {
    const candidate = nextOccurrence(schedule, { now: cursor });
    if (candidate === null || candidate > ctx.now) break;
    count += 1;
    cursor = candidate;
  }
  return count;
}
