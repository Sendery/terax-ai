import { isSchedule, MIN_INTERVAL_MINUTES, type Schedule, type Weekday } from "./recurrence";

/**
 * Compact textual schedule used by the Pi command surface, so a task can be
 * described without an arbitrary nested payload.
 *
 *   manual
 *   every:30m | every:2h | every:1d | every:45
 *   daily:09:00
 *   weekly:mon,wed@07:30 | weekly:weekdays@08:00 | weekly:weekend@10:00
 *   days:3@06:00:2026-08-01
 *   dates:2026-08-04,2026-08-09@12:00
 *   once:2026-08-04T09:15
 */
const DAY_NAMES: readonly string[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];
const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];
const WEEKEND: readonly Weekday[] = [0, 6];
const EVERY_DAY: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INTERVAL_RE = /^(\d+)([mhd]?)$/;
const ONCE_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(year, month - 1, day);
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day
  );
}

function parseDays(list: string): Weekday[] | null {
  const lower = list.toLowerCase();
  if (lower === "weekdays") return [...WEEKDAYS];
  if (lower === "weekend") return [...WEEKEND];
  const parts = lower.split(",").filter((part) => part !== "");
  if (parts.length === 0) return null;
  const days: Weekday[] = [];
  for (const part of parts) {
    const index = DAY_NAMES.indexOf(part);
    if (index === -1) return null;
    if (!days.includes(index as Weekday)) days.push(index as Weekday);
  }
  return days.sort((a, b) => a - b);
}

function splitAt(rest: string): { left: string; right: string } | null {
  const at = rest.lastIndexOf("@");
  if (at <= 0 || at === rest.length - 1) return null;
  return { left: rest.slice(0, at), right: rest.slice(at + 1) };
}

export function parseScheduleSpec(spec: string): Schedule | null {
  const trimmed = spec.trim();
  if (trimmed === "") return null;
  if (trimmed.toLowerCase() === "manual") return { kind: "manual" };

  const colon = trimmed.indexOf(":");
  if (colon <= 0) return null;
  const head = trimmed.slice(0, colon).toLowerCase();
  const rest = trimmed.slice(colon + 1);
  if (rest === "") return null;

  let schedule: Schedule | null = null;

  if (head === "every") {
    const match = INTERVAL_RE.exec(rest);
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2] || "m";
    const minutes =
      unit === "h" ? value * 60 : unit === "d" ? value * 1440 : value;
    schedule = { kind: "everyN", minutes };
  } else if (head === "daily") {
    if (!TIME_RE.test(rest)) return null;
    schedule = { kind: "weekly", days: [...EVERY_DAY], time: rest };
  } else if (head === "weekly") {
    const parts = splitAt(rest);
    if (!parts) return null;
    const days = parseDays(parts.left);
    if (!days) return null;
    schedule = { kind: "weekly", days, time: parts.right };
  } else if (head === "days") {
    const parts = splitAt(rest);
    if (!parts) return null;
    const count = Number(parts.left);
    if (!Number.isInteger(count) || count < 1) return null;
    const timeAndAnchor = parts.right.split(":");
    if (timeAndAnchor.length !== 3) return null;
    const time = `${timeAndAnchor[0]}:${timeAndAnchor[1]}`;
    const from = timeAndAnchor[2];
    if (!isRealDate(from)) return null;
    schedule = { kind: "everyNDays", days: count, time, from };
  } else if (head === "dates") {
    const parts = splitAt(rest);
    if (!parts) return null;
    const dates = parts.left.split(",").filter((part) => part !== "");
    if (dates.length === 0 || !dates.every(isRealDate)) return null;
    schedule = { kind: "dates", dates, time: parts.right };
  } else if (head === "once") {
    const match = ONCE_RE.exec(rest);
    if (!match) return null;
    const at = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      0,
      0,
    ).getTime();
    if (!Number.isFinite(at)) return null;
    schedule = { kind: "once", at };
  }

  if (schedule === null) return null;
  if (schedule.kind === "everyN" && schedule.minutes < MIN_INTERVAL_MINUTES) {
    return null;
  }
  return isSchedule(schedule) ? schedule : null;
}

function sameDays(days: readonly Weekday[], other: readonly Weekday[]): boolean {
  if (days.length !== other.length) return false;
  const set = new Set(days);
  return other.every((day) => set.has(day));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatScheduleSpec(schedule: Schedule): string {
  switch (schedule.kind) {
    case "manual":
      return "manual";
    case "everyN": {
      const { minutes } = schedule;
      if (minutes % 1440 === 0) return `every:${minutes / 1440}d`;
      if (minutes % 60 === 0) return `every:${minutes / 60}h`;
      return `every:${minutes}m`;
    }
    case "weekly": {
      const days = [...schedule.days].sort((a, b) => a - b);
      if (sameDays(days, EVERY_DAY)) return `daily:${schedule.time}`;
      if (sameDays(days, WEEKDAYS)) return `weekly:weekdays@${schedule.time}`;
      if (sameDays(days, WEEKEND)) return `weekly:weekend@${schedule.time}`;
      return `weekly:${days.map((day) => DAY_NAMES[day]).join(",")}@${schedule.time}`;
    }
    case "everyNDays":
      return `days:${schedule.days}@${schedule.time}:${schedule.from}`;
    case "dates":
      return `dates:${schedule.dates.join(",")}@${schedule.time}`;
    case "once": {
      const date = new Date(schedule.at);
      return `once:${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate(),
      )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
  }
}
