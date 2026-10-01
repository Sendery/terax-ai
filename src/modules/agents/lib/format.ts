const LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  pi: "Pi",
  opencode: "OpenCode",
  grok: "Grok",
  terax: "Terax",
};

export function displayAgent(agent: string): string {
  if (!agent) return "Agent";
  return (
    LABELS[agent.toLowerCase()] ??
    agent.charAt(0).toUpperCase() + agent.slice(1)
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The wall-clock instant a session was created, to the minute.
 *
 * A monitor row is scanned rather than read, so a session started today shows
 * four digits and nothing else; the calendar day is prefixed only once it stops
 * being today, which is exactly when "09:04" alone becomes ambiguous. Both
 * stamps are compared in local time, because that is the clock the user was
 * looking at when the session started.
 */
export function formatSessionStart(startedAt: number, now: number): string {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return "";
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return "";
  const clock = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const today = new Date(now);
  const sameDay =
    start.getFullYear() === today.getFullYear() &&
    start.getMonth() === today.getMonth() &&
    start.getDate() === today.getDate();
  if (sameDay) return clock;
  return `${MONTHS[start.getMonth()]} ${start.getDate()}, ${clock}`;
}

/**
 * How long ago something happened, in the compact form the bell already uses.
 *
 * The finest unit is the minute, so a panel refreshing on a coarse tick never
 * shows a stale value. A stamp taken in the same tick as `now`, or by a clock
 * that has since been pulled backwards, reads as "just now" rather than as a
 * negative age.
 */
export function formatSince(at: number, now: number): string {
  const delta = Math.max(0, now - at);
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  return `${Math.floor(delta / DAY)}d ago`;
}
