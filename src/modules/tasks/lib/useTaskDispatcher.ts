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
  /** True when this task's agent is already running in the leaf and only needs
   *  the prompt. */
  agentRunning: boolean;
};

export type DispatcherDeps = {
  tasks: readonly ScheduledTask[];
  paused: boolean;
  shellFlavor: ShellFlavor;
  recordRun: (run: TaskRun) => void;
  /** Records the run against the task. The session id is passed so the task can
   *  remember the session it owns, which is what tells the next run whether to
   *  create or resume it. */
  markDispatched: (taskId: string, at: number, sessionId: string) => void;
  disableTask: (taskId: string) => void;
  notify: (message: string, tone: "info" | "warning" | "error") => void;
  /** Focuses or creates the terminal tab that owns this task. */
  ensureTab: (task: ScheduledTask) => Promise<TabTarget | null>;
  writeToLeaf: (leafId: number, data: string) => void;
  shiftEnterFor: (leafId: number) => string;
  /** True once an agent TUI in this leaf has the terminal in raw mode. */
  isLeafTuiReady: (leafId: number) => boolean;
  /** Visible terminal text of this leaf, or null when it has no live buffer. */
  readLeafBuffer: (leafId: number) => string | null;
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
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const attemptsRef = useRef(new Map<string, number>());
  const timersRef = useRef(new Set<number>());
  // `settle` needs to re-dispatch a retry, but `run` is defined after it.
  const runRef = useRef<(taskId: string, trigger: RunTrigger) => void>(() => {});

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handle of timers) window.clearTimeout(handle);
      timers.clear();
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const handle = window.setTimeout(() => {
      timersRef.current.delete(handle);
      fn();
    }, ms);
    timersRef.current.add(handle);
  }, []);

  // Same bookkeeping as `later`, for the awaited waits of a prompt hand-off:
  // unmounting the dispatcher cancels them instead of leaving them pending.
  const sleep = useCallback(
    (ms: number) => new Promise<void>((resolve) => later(resolve, ms)),
    [later],
  );

  const release = useCallback((taskId: string) => {
    setQueue((current) => ({
      running: current.running.filter((slot) => slot.taskId !== taskId),
      pending: current.pending.filter((id) => id !== taskId),
    }));
  }, []);

  const settle = useCallback(
    (task: ScheduledTask, run: TaskRun, ok: boolean) => {
      const d = depsRef.current;
      d.recordRun(run);
      release(task.id);
      if (ok) {
        attemptsRef.current.delete(task.id);
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
        later(() => runRef.current(task.id, "recovery"), outcome.delayMs);
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
    [release, later],
  );

  const runHeadless = useCallback(
    async (
      task: ScheduledTask,
      run: TaskRun,
      sessionId: string,
      resume: boolean,
    ) => {
      const d = depsRef.current;
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
        );
      }
    },
    [later, settle],
  );

  const runInTab = useCallback(
    async (
      task: ScheduledTask,
      run: TaskRun,
      sessionId: string,
      resume: boolean,
    ) => {
      const d = depsRef.current;
      try {
        const target = await d.ensureTab(task);
        if (!target) {
          settle(
            task,
            finishRun(run, {
              status: "failed",
              endedAt: Date.now(),
              message: "Could not open a terminal tab for this task.",
            }),
            false,
          );
          return;
        }
        if (task.prompt.trim() === "") {
          settle(
            task,
            finishRun(run, {
              status: "failed",
              endedAt: Date.now(),
              message: "The prompt is empty, so nothing was sent.",
            }),
            false,
          );
          return;
        }
        if (!target.agentRunning) {
          const argv = buildAgentArgv(task, sessionId, {
            headless: false,
            resume,
          });
          d.writeToLeaf(
            target.leafId,
            `${formatCommandLine(argv, d.shellFlavor)}\r`,
          );
        }
        const result = await handOffPrompt(
          {
            write: (data) => depsRef.current.writeToLeaf(target.leafId, data),
            isReady: () => depsRef.current.isLeafTuiReady(target.leafId),
            readBuffer: () => depsRef.current.readLeafBuffer(target.leafId),
            sleep,
            now: Date.now,
          },
          // Resolved late: the line-break encoding depends on the keyboard
          // protocol the agent only negotiates once its TUI is up.
          () =>
            promptKeystrokes(
              task.prompt,
              depsRef.current.shiftEnterFor(target.leafId),
            ),
        );
        // An interactive run stays live in the tab; the card reports the agent
        // state from the terminal signal rather than an exit code.
        settle(
          task,
          finishRun(run, {
            status: "ok",
            endedAt: Date.now(),
            message: handoffMessage(result, {
              tabId: target.tabId,
              reused: target.agentRunning,
            }),
          }),
          true,
        );
      } catch (error) {
        settle(
          task,
          finishRun(run, {
            status: "failed",
            endedAt: Date.now(),
            message: String(error),
          }),
          false,
        );
      }
    },
    [sleep, settle],
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
      depsRef.current.markDispatched(task.id, now, sessionId);
      setQueue((current) => ({
        running: [...current.running, { taskId: task.id, startedAt: now }],
        pending: current.pending.filter((id) => id !== task.id),
      }));
      if (task.target === "headless") {
        void runHeadless(task, run, sessionId, resume);
      } else {
        void runInTab(task, run, sessionId, resume);
      }
    },
    [runHeadless, runInTab],
  );

  const run = useCallback(
    (taskId: string, trigger: RunTrigger) => {
      const d = depsRef.current;
      const task = d.tasks.find((entry) => entry.id === taskId);
      if (!task) return;
      if (d.paused && trigger !== "manual") return;
      const outcome = admitOccurrence(task, queue);
      if (outcome.decision === "skip") {
        if (outcome.notify) {
          d.notify(`${task.name} skipped: ${outcome.reason}`, "warning");
        }
        return;
      }
      if (outcome.decision === "queue") {
        setQueue((current) => ({
          ...current,
          pending: [...current.pending, task.id],
        }));
        return;
      }
      start(task, trigger);
    },
    [queue, start],
  );
  runRef.current = run;

  // Drain the queue as soon as a slot frees up.
  useEffect(() => {
    if (queue.pending.length === 0) return;
    const next = queue.pending.find(
      (id) => !queue.running.some((slot) => slot.taskId === id),
    );
    if (next === undefined) return;
    const task = depsRef.current.tasks.find((entry) => entry.id === next);
    if (!task) {
      setQueue((current) => ({
        ...current,
        pending: current.pending.filter((id) => id !== next),
      }));
      return;
    }
    start(task, "schedule");
  }, [queue, start]);

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
