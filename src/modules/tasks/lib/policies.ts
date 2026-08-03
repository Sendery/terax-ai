import { countMissedOccurrences } from "./recurrence";
import { isExhausted, remainingRuns, RUN_TIMEOUT_MS, type ScheduledTask } from "./task";

/** A queued occurrence beyond this depth is dropped and the drop is notified. */
export const MAX_QUEUE_DEPTH = 1;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 3_600_000;
const MISSED_SCAN_LIMIT = 500;

export type RunSlot = {
  taskId: string;
  startedAt: number;
};

export type QueueState = {
  running: readonly RunSlot[];
  pending: readonly string[];
};

export type MissedOutcome = {
  /** Occurrences lost since the last run, reported even when none are replayed. */
  missed: number;
  /** How many recovery runs to dispatch now. */
  dispatch: number;
  /** True when the policy hands the decision to the user. */
  awaitingConfirmation: boolean;
};

/**
 * Downtime recovery. The default policy replays exactly one occurrence and then
 * resumes the normal cadence, so an hourly watcher that lost three slots wakes
 * once instead of three times.
 */
export function resolveMissed(
  task: ScheduledTask,
  now: number,
): MissedOutcome {
  const idle: MissedOutcome = {
    missed: 0,
    dispatch: 0,
    awaitingConfirmation: false,
  };
  if (!task.enabled) return idle;
  const missed = countMissedOccurrences(task.schedule, {
    now,
    lastRunAt: task.lastRunAt,
    limit: MISSED_SCAN_LIMIT,
  });
  if (missed === 0) return idle;

  const budget = remainingRuns(task);
  const clamp = (count: number) => Math.max(0, Math.min(count, budget));

  switch (task.missed) {
    case "skip":
      return { missed, dispatch: 0, awaitingConfirmation: false };
    case "runOnce":
      return { missed, dispatch: clamp(1), awaitingConfirmation: false };
    case "runAll":
      return { missed, dispatch: clamp(missed), awaitingConfirmation: false };
    case "askOnResume":
      return { missed, dispatch: 0, awaitingConfirmation: true };
  }
}

export type AdmitOutcome = {
  decision: "run" | "queue" | "skip";
  notify: boolean;
  reason?: string;
};

/**
 * Overlap control for a task firing while its own previous run is still going.
 * The queue holds a single occupant; a further occurrence is dropped and the
 * drop is surfaced, because silently stacking wake-ups is worse than skipping.
 */
export function admitOccurrence(
  task: ScheduledTask,
  state: QueueState,
): AdmitOutcome {
  if (!task.enabled) {
    return { decision: "skip", notify: false, reason: "disabled" };
  }
  if (isExhausted(task)) {
    return { decision: "skip", notify: false, reason: "run budget spent" };
  }
  const running = state.running.some((slot) => slot.taskId === task.id);
  if (!running) return { decision: "run", notify: false };
  if (task.overlap === "parallel") return { decision: "run", notify: false };
  if (task.overlap === "skip") {
    return {
      decision: "skip",
      notify: true,
      reason: "previous run still in progress",
    };
  }
  const queued = state.pending.filter((id) => id === task.id).length;
  if (queued < MAX_QUEUE_DEPTH) {
    return { decision: "queue", notify: false };
  }
  return { decision: "skip", notify: true, reason: "queue full" };
}

export function isRunTimedOut(slot: RunSlot, now: number): boolean {
  return now - slot.startedAt > RUN_TIMEOUT_MS;
}

export type FailureOutcome = {
  action: "retry" | "disable" | "giveUp";
  delayMs: number;
  notify: "error" | "warning" | "none";
};

/**
 * Failure handling for the `attempt`-th consecutive failed run, 1-based. Retries
 * back off exponentially and are capped so a broken task never hot-loops; once
 * the retries are spent the task is disabled with a red notification.
 */
export function resolveFailure(
  task: ScheduledTask,
  attempt: number,
): FailureOutcome {
  const delayMs = Math.min(
    RETRY_MAX_MS,
    RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
  if (attempt <= task.failure.retries) {
    return { action: "retry", delayMs, notify: "warning" };
  }
  return {
    action: task.failure.thenDisable ? "disable" : "giveUp",
    delayMs: 0,
    notify: "error",
  };
}
