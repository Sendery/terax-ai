const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Age of a commit, in the compact form a history view uses.
 *
 * Commit timestamps come from whichever machine authored them, so a stamp
 * ahead of the local clock is normal after a rebase or a bad clock; it reads as
 * "now" rather than a negative age.
 */
export function relativeCommitTime(secs: number, nowSecs: number): string {
  if (!secs) return "";
  const delta = Math.max(0, nowSecs - secs);
  if (delta < MINUTE) return "now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d`;
  if (delta < MONTH) return `${Math.floor(delta / WEEK)}w`;
  if (delta < YEAR) return `${Math.floor(delta / MONTH)}mo`;
  return `${Math.floor(delta / YEAR)}y`;
}
