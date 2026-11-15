import type { ScheduledTask } from "@/modules/tasks/lib/task";

export function dispatchedTaskPatch(
  task: ScheduledTask,
  at: number,
): Pick<ScheduledTask, "lastRunAt" | "runCount"> {
  return { lastRunAt: at, runCount: task.runCount + 1 };
}

export function createdTaskSessionPatch(
  task: ScheduledTask,
  sessionId: string,
  cwd: string,
  expectedSeed: string | undefined,
): Pick<ScheduledTask, "sessions"> | null {
  if (
    task.seed !== expectedSeed ||
    task.cwd !== cwd ||
    task.mode !== "task" ||
    task.sessions.some((session) => session.id === sessionId)
  )
    return null;
  return { sessions: [{ id: sessionId, cwd }, ...task.sessions] };
}
