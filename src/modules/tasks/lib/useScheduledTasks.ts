import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStateMirror, type StateMirror } from "./stateMirror";

import {
  cloneTask,
  moveTask,
  recentTaskDefaults,
  regenerateSeed,
  removeTask as removeFromList,
  reschedule,
  setTaskEnabled,
  type TaskDefaults,
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
  /** Latest task list, including mutations React has not rendered yet.
   *  Handlers driven from outside React, such as the Pi command bridge, must
   *  read through this instead of `tasks`. */
  readTasks: () => readonly ScheduledTask[];
  add: (input: TaskInput) => ScheduledTask;
  update: (id: string, patch: TaskPatch) => void;
  /** Copies a task, disabled, so it can be edited before it runs. Returns null
   *  when the source task is gone. */
  clone: (id: string) => ScheduledTask | null;
  /** Points a task at a brand new agent session. Returns the new seed, since
   *  the updated task is not readable until React commits the state. */
  regenerate: (id: string) => string | null;
  /** Parameters a new task should start from, or null on an empty list. */
  defaults: TaskDefaults | null;
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

  const mirrorRef = useRef<StateMirror<readonly ScheduledTask[]> | null>(null);
  if (!mirrorRef.current) {
    mirrorRef.current = createStateMirror<readonly ScheduledTask[]>(tasks);
  }
  const mirror = mirrorRef.current;
  mirror.sync(tasks);

  const readTasks = useCallback(() => mirror.read(), [mirror]);
  const commitTasks = useCallback(
    (next: (current: readonly ScheduledTask[]) => readonly ScheduledTask[]) =>
      setTasks(mirror.commit(next)),
    [mirror],
  );

  const add = useCallback(
    (input: TaskInput) => {
      const created = reschedule(createTask(input), Date.now());
      commitTasks((current) => upsertTask(current, created));
      return created;
    },
    [commitTasks],
  );

  const update = useCallback(
    (id: string, patch: TaskPatch) => {
      commitTasks((current) => {
        const stamp = Date.now();
        return patchList(current, id, patch).map((task) =>
          task.id === id ? reschedule(task, stamp) : task,
        );
      });
    },
    [commitTasks],
  );

  const clone = useCallback(
    (id: string) => {
      const current = mirror.read();
      const source = current.find((task) => task.id === id);
      if (!source) return null;
      const copy = cloneTask(source, Date.now(), current);
      commitTasks((list) => upsertTask(list, copy));
      return copy;
    },
    [commitTasks, mirror],
  );

  const regenerate = useCallback(
    (id: string) => {
      const source = mirror.read().find((task) => task.id === id);
      if (!source) return null;
      const next = regenerateSeed(source);
      commitTasks((list) => list.map((task) => (task.id === id ? next : task)));
      return next.seed ?? null;
    },
    [commitTasks, mirror],
  );

  const remove = useCallback(
    (id: string) => {
      commitTasks((current) => removeFromList(current, id));
      setRuns((current) => {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    },
    [commitTasks],
  );

  const setEnabled = useCallback(
    (id: string, enabled: boolean) => {
      commitTasks((current) =>
        setTaskEnabled(current, id, enabled, Date.now()),
      );
    },
    [commitTasks],
  );

  const move = useCallback(
    (id: string, toIndex: number) => {
      commitTasks((current) => moveTask(current, id, toIndex));
    },
    [commitTasks],
  );

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

  const rescheduleOne = useCallback(
    (id: string) => {
      const stamp = Date.now();
      commitTasks((current) =>
        current.map((task) =>
          task.id === id ? reschedule(task, stamp) : task,
        ),
      );
    },
    [commitTasks],
  );

  const rescheduleAll = useCallback(() => {
    const stamp = Date.now();
    commitTasks((current) => current.map((task) => reschedule(task, stamp)));
  }, [commitTasks]);

  const defaults = useMemo(() => recentTaskDefaults(tasks), [tasks]);

  return useMemo(
    () => ({
      tasks,
      runs,
      paused,
      hydrated,
      now,
      readTasks,
      add,
      update,
      clone,
      regenerate,
      defaults,
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
      readTasks,
      add,
      update,
      clone,
      regenerate,
      defaults,
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
