import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  moveTask,
  removeTask as removeFromList,
  reschedule,
  setTaskEnabled,
  type TaskPatch,
  updateTask as patchList,
  upsertTask,
} from "./collection";
import { appendRun, type TaskRun } from "./runs";
import {
  hydrateTasksState,
  persistPaused,
  persistRuns,
  persistTasks,
  type RunHistory,
} from "./store";
import { createTask, type ScheduledTask, type TaskInput } from "./task";

/** Countdown refresh. Coarse on purpose: the native scheduler owns firing, this
 *  only keeps the visible "in 3m" text honest. */
const TICK_MS = 5_000;

export type ScheduledTasksApi = {
  tasks: readonly ScheduledTask[];
  runs: RunHistory;
  paused: boolean;
  hydrated: boolean;
  /** Coarse clock driving countdown labels. */
  now: number;
  add: (input: TaskInput) => ScheduledTask;
  update: (id: string, patch: TaskPatch) => void;
  remove: (id: string) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  move: (id: string, toIndex: number) => void;
  setPaused: (paused: boolean) => void;
  recordRun: (run: TaskRun) => void;
  /** Recomputes every pending schedule, e.g. after resuming from pause. */
  rescheduleAll: () => void;
  /** Recomputes one task's next instant after its occurrence was consumed. */
  rescheduleOne: (id: string) => void;
};

export function useScheduledTasks(): ScheduledTasksApi {
  const [tasks, setTasks] = useState<readonly ScheduledTask[]>([]);
  const [runs, setRuns] = useState<RunHistory>({});
  const [paused, setPausedState] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void hydrateTasksState().then((state) => {
      if (cancelled) return;
      const stamp = Date.now();
      setTasks(state.tasks.map((task) => reschedule(task, stamp)));
      setRuns(state.runs);
      setPausedState(state.paused);
      hydratedRef.current = true;
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void persistTasks(tasks);
  }, [tasks, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    void persistRuns(runs);
  }, [runs, hydrated]);

  // No tasks means no timer at all: an unused feature costs nothing.
  const needsTick = tasks.length > 0;
  useEffect(() => {
    if (!needsTick) return;
    const handle = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(handle);
  }, [needsTick]);

  const add = useCallback((input: TaskInput) => {
    const created = reschedule(createTask(input), Date.now());
    setTasks((current) => upsertTask(current, created));
    return created;
  }, []);

  const update = useCallback((id: string, patch: TaskPatch) => {
    setTasks((current) => {
      const stamp = Date.now();
      return patchList(current, id, patch).map((task) =>
        task.id === id ? reschedule(task, stamp) : task,
      );
    });
  }, []);

  const remove = useCallback((id: string) => {
    setTasks((current) => removeFromList(current, id));
    setRuns((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const setEnabled = useCallback((id: string, enabled: boolean) => {
    setTasks((current) => setTaskEnabled(current, id, enabled, Date.now()));
  }, []);

  const move = useCallback((id: string, toIndex: number) => {
    setTasks((current) => moveTask(current, id, toIndex));
  }, []);

  const setPaused = useCallback((next: boolean) => {
    setPausedState(next);
    void persistPaused(next);
  }, []);

  const recordRun = useCallback((run: TaskRun) => {
    setRuns((current) => ({
      ...current,
      [run.taskId]: [...appendRun(current[run.taskId] ?? [], run)],
    }));
  }, []);

  const rescheduleOne = useCallback((id: string) => {
    const stamp = Date.now();
    setTasks((current) =>
      current.map((task) => (task.id === id ? reschedule(task, stamp) : task)),
    );
  }, []);

  const rescheduleAll = useCallback(() => {
    const stamp = Date.now();
    setTasks((current) => current.map((task) => reschedule(task, stamp)));
  }, []);

  return useMemo(
    () => ({
      tasks,
      runs,
      paused,
      hydrated,
      now,
      add,
      update,
      remove,
      setEnabled,
      move,
      setPaused,
      recordRun,
      rescheduleAll,
      rescheduleOne,
    }),
    [
      tasks,
      runs,
      paused,
      hydrated,
      now,
      add,
      update,
      remove,
      setEnabled,
      move,
      setPaused,
      recordRun,
      rescheduleAll,
      rescheduleOne,
    ],
  );
}
