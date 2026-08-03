import { isExhausted, type ScheduledTask } from "./task";

function isArmable(task: ScheduledTask): boolean {
  return (
    task.enabled &&
    !isExhausted(task) &&
    task.nextRunAt !== null &&
    task.nextRunAt !== undefined
  );
}

/**
 * Instant the native timer should be armed for, or null to stay idle. Null when
 * nothing is scheduled or the global pause is engaged, so an unused scheduler
 * costs no timer at all.
 */
export function earliestDeadline(
  tasks: readonly ScheduledTask[],
  paused: boolean,
): number | null {
  if (paused) return null;
  let earliest: number | null = null;
  for (const task of tasks) {
    if (!isArmable(task)) continue;
    const next = task.nextRunAt as number;
    if (earliest === null || next < earliest) earliest = next;
  }
  return earliest;
}

/** Tasks whose instant has arrived, oldest first so a backlog drains in order. */
export function dueTasks(
  tasks: readonly ScheduledTask[],
  now: number,
): ScheduledTask[] {
  return tasks
    .filter((task) => isArmable(task) && (task.nextRunAt as number) <= now)
    .sort((a, b) => (a.nextRunAt as number) - (b.nextRunAt as number));
}
