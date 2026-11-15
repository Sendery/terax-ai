import type { TaskTerminal } from "@/modules/tasks/lib/taskTerminal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { native } from "@/modules/ai/lib/native";

import {
  buildAgentArgv,
  formatCommandLine,
  promptKeystrokes,
  recoverCommandLine,
  sessionIdFor,
  type ShellFlavor,
  summariseOutput,
} from "./dispatch";
import { handoffMessage, handOffPrompt } from "./handoff";
import { admitOccurrence, type QueueState, resolveFailure } from "./policies";
import { finishRun, newRun, type RunTrigger, type TaskRun } from "./runs";
import { RUN_TIMEOUT_MS, type ScheduledTask } from "./task";

const POLL_MS = 2_000;

export type TabTarget = {
  tabId: number;
  leafId: number;
  spaceId?: string;
  /** True when this task's agent is already running in the leaf and only needs
   *  the prompt. */
  agentRunning: boolean;
};

export type DispatcherDeps = {
  tasks: readonly ScheduledTask[];
  readTasks?: () => readonly ScheduledTask[];
  paused: boolean;
  shellFlavor: ShellFlavor;
  recordRun: (run: TaskRun) => void;
  markDispatched: (taskId: string, at: number) => void;
  markSessionCreated: (
    taskId: string,
    sessionId: string,
    cwd: string,
    expectedSeed: string | undefined,
  ) => void;
  disableTask: (taskId: string) => void;
  notify: (message: string, tone: "info" | "warning" | "error") => void;
  /** Focuses or creates the terminal tab that owns this task. */
  ensureTab: (task: ScheduledTask) => Promise<TabTarget | null>;
  captureTarget: (
    target: TabTarget,
    task: ScheduledTask,
    current: () => boolean,
  ) => Promise<TaskTerminal | null>;
  /** Opens a throwaway terminal on a command line, for the recover action. */
  openTerminalWith: (cwd: string, commandLine: string) => void;
};

export type TaskDispatcherApi = {
  runningIds: readonly string[];
  queuedIds: readonly string[];
  run: (taskId: string, trigger: RunTrigger) => void;
  recover: (run: TaskRun) => void;
};

export function useTaskDispatcher(deps: DispatcherDeps): TaskDispatcherApi {
  const [queue, setQueue] = useState<QueueState>({ running: [], pending: [] });
  const queueRef = useRef(queue);
  const updateQueue = useCallback(
    (update: (current: QueueState) => QueueState) => {
      const next = update(queueRef.current);
      queueRef.current = next;
      setQueue(next);
    },
    [],
  );
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const readTask = useCallback((taskId: string) => {
    const d = depsRef.current;
    return (d.readTasks?.() ?? d.tasks).find((task) => task.id === taskId);
  }, []);
  const attemptsRef = useRef(new Map<string, number>());
  const active = useRef(true);
  const lifetime = useRef(0);
  const sleepers = useRef(new Map<number, () => void>());
  const timersRef = useRef(new Set<number>());
  // `settle` needs to re-dispatch a retry, but `run` is defined after it.
  const runRef = useRef<(taskId: string, trigger: RunTrigger) => void>(
    () => {},
  );

  useEffect(() => {
    const timers = timersRef.current;
    active.current = true;
    return () => {
      active.current = false;
      lifetime.current++;
      for (const handle of timers) window.clearTimeout(handle);
      timers.clear();
      for (const resolve of sleepers.current.values()) resolve();
      sleepers.current.clear();
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    if (!active.current) return null;
    const generation = lifetime.current;
    const handle = window.setTimeout(() => {
      timersRef.current.delete(handle);
      sleepers.current.delete(handle);
      if (active.current && lifetime.current === generation) fn();
    }, ms);
    timersRef.current.add(handle);
    return handle;
  }, []);

  // Same bookkeeping as `later`, for the awaited waits of a prompt hand-off:
  // unmounting the dispatcher cancels them instead of leaving them pending.
  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const handle = later(resolve, ms);
        if (handle === null) resolve();
        else sleepers.current.set(handle, resolve);
      }),
    [later],
  );

  const release = useCallback(
    (taskId: string, runId: string) => {
      updateQueue((current) => ({
        running: current.running.filter(
          (slot) => slot.taskId !== taskId || slot.runId !== runId,
        ),
        pending: current.pending,
      }));
    },
    [updateQueue],
  );

  const settle = useCallback(
    (task: ScheduledTask, run: TaskRun, ok: boolean, retryable = true) => {
      if (!active.current) return;
      const d = depsRef.current;
      d.recordRun(run);
      release(task.id, run.id);
      if (ok) {
        attemptsRef.current.delete(task.id);
        return;
      }
      if (!retryable) {
        attemptsRef.current.delete(task.id);
        d.notify(
          `${task.name}: delivery could not be confirmed; automatic retry skipped`,
          "warning",
        );
        return;
      }
      const attempt = (attemptsRef.current.get(task.id) ?? 0) + 1;
      attemptsRef.current.set(task.id, attempt);
      const outcome = resolveFailure(task, attempt);
      if (outcome.action === "retry") {
        d.notify(
          `${task.name} failed, retrying in ${Math.round(outcome.delayMs / 1000)}s`,
          "warning",
        );
        const retrySeed = task.seed;
        later(() => {
          const latest = readTask(task.id);
          if (!latest || latest.seed !== retrySeed) return;
          runRef.current(task.id, "recovery");
        }, outcome.delayMs);
        return;
      }
      attemptsRef.current.delete(task.id);
      if (outcome.action === "disable") {
        d.disableTask(task.id);
        d.notify(`${task.name} disabled after repeated failures`, "error");
      } else {
        d.notify(`${task.name} failed`, "error");
      }
    },
    [release, later, readTask],
  );

  const runHeadless = useCallback(
    async (
      task: ScheduledTask,
      run: TaskRun,
      sessionId: string,
      resume: boolean,
    ) => {
      const d = depsRef.current;
      const seed = task.seed;
      const currentConversation = () => {
        const latest = readTask(task.id);
        return latest !== undefined && latest.seed === seed;
      };
      const argv = buildAgentArgv(task, sessionId, { headless: true, resume });
      const commandLine = formatCommandLine(argv, d.shellFlavor);
      try {
        // The user consented to this directory when creating the task.
        await native.workspaceAuthorize(task.cwd);
        // Mark where the session file ends now, so accounting measures this
        // trigger rather than the whole session history.
        const sessionStart = await native
          .piSessionOffset(sessionId)
          .catch(() => 0);
        const handle = await native.shellBgSpawn(commandLine, task.cwd);
        if (currentConversation())
          d.markSessionCreated(task.id, sessionId, task.cwd, seed);
        let offset = 0;
        let output = "";
        const poll = async () => {
          const logs = await native.shellBgLogs(handle, offset);
          offset = logs.next_offset;
          output += logs.bytes;
          if (logs.exited) {
            const ok = logs.exit_code === 0;
            const accounting = await native
              .piSessionUsage(sessionId, sessionStart)
              .catch(() => null);
            settle(
              task,
              finishRun(run, {
                status: ok ? "ok" : "failed",
                endedAt: Date.now(),
                exitCode: logs.exit_code ?? undefined,
                message: summariseOutput(output, logs.exit_code),
                ...(accounting && accounting.assistantMessages > 0
                  ? {
                      usage: accounting.usage,
                      ...(accounting.stopReason
                        ? { stopReason: accounting.stopReason }
                        : {}),
                      ...(accounting.model ? { model: accounting.model } : {}),
                      ...(accounting.path
                        ? { sessionFile: accounting.path }
                        : {}),
                    }
                  : {}),
              }),
              ok,
              currentConversation(),
            );
            return;
          }
          if (Date.now() - run.startedAt > RUN_TIMEOUT_MS) {
            await native.shellBgKill(handle);
            settle(
              task,
              finishRun(run, {
                status: "timeout",
                endedAt: Date.now(),
                message: "Killed after the 30 minute run timeout.",
              }),
              false,
              currentConversation(),
            );
            return;
          }
          later(() => void poll(), POLL_MS);
        };
        later(() => void poll(), POLL_MS);
      } catch (error) {
        settle(
          task,
          finishRun(run, {
            status: "failed",
            endedAt: Date.now(),
            message: String(error),
          }),
          false,
          currentConversation(),
        );
      }
    },
    [later, settle, readTask],
  );

  const runInTab = useCallback(
    async (
      task: ScheduledTask,
      run: TaskRun,
      sessionId: string,
      resume: boolean,
    ) => {
      const d = depsRef.current;
      const seed = task.seed;
      const generation = lifetime.current;
      const alive = () => active.current && lifetime.current === generation;
      const current = () => {
        const latest = readTask(task.id);
        return alive() && latest !== undefined && latest.seed === seed;
      };
      let effectiveRun = run;
      let remembered: string | null = null;
      const remember = (known: string) => {
        if (remembered === known || !current()) return;
        d.markSessionCreated(task.id, known, task.cwd, seed);
        effectiveRun = { ...run, sessionId: known };
        remembered = known;
      };
      let promptAttempted = false;
      let launchAttempted = false;
      let launchConfirmed = false;
      const uncertain = () =>
        promptAttempted || (launchAttempted && !launchConfirmed);
      try {
        const target = await d.ensureTab(task);
        if (!current())
          throw new Error("Task terminal is no longer available.");
        if (!target)
          throw new Error("Could not open a terminal tab for this task.");
        if (task.prompt.trim() === "")
          throw new Error("The prompt is empty, so nothing was sent.");
        const terminal = await d.captureTarget(target, task, current);
        if (!current() || !terminal)
          throw new Error("Task terminal is no longer available.");
        if (!target.agentRunning) {
          const argv = buildAgentArgv(task, sessionId, {
            headless: false,
            resume,
          });
          await terminal.launch(
            formatCommandLine(argv, d.shellFlavor),
            current,
            () => {
              launchAttempted = true;
            },
          );
          launchConfirmed = true;
          remember(sessionId);
        } else {
          const known = terminal.sessionId();
          if (known !== null) remember(known);
          else if (task.agent === "codex") remember(sessionId);
        }
        const result = await handOffPrompt(
          {
            write: async (data) => {
              if (!current() || !terminal.current())
                throw new Error("Task terminal is no longer available.");
              promptAttempted = true;
              await terminal.write(data, current);
            },
            isCurrent: () => current() && terminal.current(),
            isReady: terminal.isReady,
            prompt: task.prompt,
            readBuffer: () => terminal.readBuffer(current),
            sleep,
            now: Date.now,
          },
          async () =>
            promptKeystrokes(task.prompt, await terminal.shiftEnter()),
        );
        if (!current())
          throw new Error("Task terminal is no longer available.");
        if (target.agentRunning) {
          const known = terminal.sessionId();
          if (known !== null) remember(known);
        }
        const ok = result.ready && result.confirmed;
        settle(
          task,
          finishRun(effectiveRun, {
            status: ok ? "ok" : "failed",
            endedAt: Date.now(),
            message:
              handoffMessage(result, {
                tabId: target.tabId,
                reused: target.agentRunning,
              }) +
              (!ok && uncertain()
                ? " Automatic retry skipped because delivery is uncertain."
                : ""),
          }),
          ok,
          !promptAttempted,
        );
      } catch (error) {
        if (!alive()) return;
        settle(
          task,
          finishRun(effectiveRun, {
            status: "failed",
            endedAt: Date.now(),
            message:
              String(error) +
              (uncertain()
                ? " Automatic retry skipped because delivery is uncertain."
                : ""),
          }),
          false,
          !uncertain() && current(),
        );
      }
    },
    [sleep, settle, readTask],
  );

  const start = useCallback(
    (task: ScheduledTask, trigger: RunTrigger) => {
      const now = Date.now();
      const sessionId = sessionIdFor(task, now);
      // The task only remembers a session once a run has created it, so this is
      // also the answer to "does this session already exist".
      const resume = task.sessions.some((session) => session.id === sessionId);
      const run = newRun(
        {
          taskId: task.id,
          sessionId,
          cwd: task.cwd,
          trigger,
          agent: task.agent,
          attempt: (attemptsRef.current.get(task.id) ?? 0) + 1,
        },
        now,
      );
      depsRef.current.recordRun(run);
      depsRef.current.markDispatched(task.id, now);
      updateQueue((current) => ({
        running: [
          ...current.running,
          { taskId: task.id, runId: run.id, startedAt: now },
        ],
        pending: current.pending.filter((id) => id !== task.id),
      }));
      if (task.target === "headless") {
        void runHeadless(task, run, sessionId, resume);
      } else {
        void runInTab(task, run, sessionId, resume);
      }
    },
    [runHeadless, runInTab, updateQueue],
  );

  const run = useCallback(
    (taskId: string, trigger: RunTrigger) => {
      if (!active.current) return;
      const d = depsRef.current;
      const task = readTask(taskId);
      if (!task) return;
      if (d.paused && trigger !== "manual") return;
      const outcome = admitOccurrence(task, queueRef.current);
      if (outcome.decision === "skip") {
        if (outcome.notify) {
          d.notify(`${task.name} skipped: ${outcome.reason}`, "warning");
        }
        return;
      }
      if (outcome.decision === "queue") {
        updateQueue((current) => ({
          ...current,
          pending: [...current.pending, task.id],
        }));
        return;
      }
      start(task, trigger);
    },
    [start, updateQueue, readTask],
  );
  runRef.current = run;

  // Drain the queue as soon as a slot frees up.
  useEffect(() => {
    if (queue.pending.length === 0) return;
    const current = queueRef.current;
    if (current.pending.length === 0) return;
    const next = current.pending.find(
      (id) => !current.running.some((slot) => slot.taskId === id),
    );
    if (next === undefined) return;
    const task = readTask(next);
    if (!task) {
      updateQueue((current) => ({
        ...current,
        pending: current.pending.filter((id) => id !== next),
      }));
      return;
    }
    start(task, "schedule");
  }, [queue, start, updateQueue, readTask]);

  const recover = useCallback((run: TaskRun) => {
    const d = depsRef.current;
    d.openTerminalWith(
      run.cwd,
      recoverCommandLine(
        { cwd: run.cwd, sessionId: run.sessionId, agent: run.agent },
        d.shellFlavor,
      ),
    );
  }, []);

  const runningIds = useMemo(
    () => queue.running.map((slot) => slot.taskId),
    [queue.running],
  );

  return useMemo(
    () => ({ runningIds, queuedIds: queue.pending, run, recover }),
    [runningIds, queue.pending, run, recover],
  );
}
