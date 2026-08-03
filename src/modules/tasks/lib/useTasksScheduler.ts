import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { resolveMissed } from "./policies";
import type { RunTrigger } from "./runs";
import { dueTasks, earliestDeadline } from "./scheduling";
import type { ScheduledTask } from "./task";

const TASK_DUE_EVENT = "terax:task-due";

export type TasksSchedulerDeps = {
  tasks: readonly ScheduledTask[];
  paused: boolean;
  /** True once the persisted state has loaded; recovery must not run before. */
  hydrated: boolean;
  run: (taskId: string, trigger: RunTrigger) => void;
  /** Recomputes the next instant for a task whose occurrence was consumed. */
  reschedule: (taskId: string) => void;
  notify: (message: string, tone: "info" | "warning" | "error") => void;
};

function arm(at: number | null): void {
  void invoke("scheduler_arm", { atMs: at }).catch(() => {
    // A failed arm leaves the previous deadline in place; the next state change
    // re-arms. Never surface this as a task failure.
  });
}

/**
 * Bridges the pure schedule to the native wake-up timer.
 *
 * The frontend remains the single source of truth: it computes the next instant
 * and decides what is due. Rust only sleeps and knocks, because a webview timer
 * is throttled while the window is in the background.
 */
export function useTasksScheduler(deps: TasksSchedulerDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const recoveredRef = useRef(false);

  const deadline = earliestDeadline(deps.tasks, deps.paused);

  useEffect(() => {
    arm(deadline);
  }, [deadline]);

  // Disarm on unmount so a reloaded webview does not leave a stale deadline.
  useEffect(() => () => arm(null), []);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen<number>(TASK_DUE_EVENT, () => {
      const d = depsRef.current;
      if (d.paused) return;
      const now = Date.now();
      for (const task of dueTasks(d.tasks, now)) {
        d.run(task.id, "schedule");
        d.reschedule(task.id);
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // Downtime recovery, once per session and only after hydration so the
  // persisted lastRunAt is known.
  useEffect(() => {
    if (!deps.hydrated || recoveredRef.current) return;
    recoveredRef.current = true;
    const d = depsRef.current;
    if (d.paused) return;
    const now = Date.now();
    for (const task of d.tasks) {
      const outcome = resolveMissed(task, now);
      if (outcome.missed === 0) continue;
      if (outcome.awaitingConfirmation) {
        d.notify(
          `${task.name} missed ${outcome.missed} run${
            outcome.missed === 1 ? "" : "s"
          } and is waiting for you`,
          "warning",
        );
        continue;
      }
      for (let i = 0; i < outcome.dispatch; i += 1) {
        d.run(task.id, "recovery");
      }
      if (outcome.dispatch > 0) {
        d.notify(
          `${task.name} recovered ${outcome.dispatch} of ${outcome.missed} missed run${
            outcome.missed === 1 ? "" : "s"
          }`,
          "info",
        );
      }
      d.reschedule(task.id);
    }
  }, [deps.hydrated]);
}
