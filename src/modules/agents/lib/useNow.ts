import { useEffect, useState } from "react";

/** Coarse enough that a minute-resolution label is never more than this stale. */
export const NOW_TICK_MS = 30_000;

/**
 * A clock that advances on an interval.
 *
 * Relative ages go stale on their own, with no state change to re-render on, so
 * a surface that shows them needs its own tick. Keeping the tick here rather
 * than in each row means one timer per surface instead of one per session, and
 * `active` lets a surface with nothing to age (empty, or hidden) hold no timer
 * at all. The clock is re-read when it is re-armed, so a panel that stops and
 * restarts ticking never renders the instant it went idle.
 */
export function useNow(active: boolean, intervalMs: number = NOW_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);

  return now;
}
