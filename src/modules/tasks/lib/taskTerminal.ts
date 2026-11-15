import { isRestorableSessionId } from "@/modules/agents/lib/restore";
import type { AgentSession } from "@/modules/agents/lib/types";
import type { Tab } from "@/modules/tabs";
import { findLeafCwd, hasLeaf } from "@/modules/terminal/lib/panes";
import type { TerminalInput } from "@/modules/terminal/lib/terminalInput";
import type { TerminalSubmission } from "@/modules/terminal/lib/sessionSubmission";
import type { ScheduledTask } from "@/modules/tasks/lib/task";
import type { TabTarget } from "@/modules/tasks/lib/useTaskDispatcher";

export type TaskTerminal = {
  current: () => boolean;
  sessionId: () => string | null;
  launch: (
    command: string,
    current?: () => boolean,
    onWriteAttempt?: () => void,
  ) => Promise<void>;
  write: (text: string, current?: () => boolean) => Promise<void>;
  isReady: () => boolean;
  shiftEnter: () => Promise<string>;
  readBuffer: (current?: () => boolean) => Promise<string | null>;
};

export function createTaskTerminal(options: {
  target: TabTarget;
  task: ScheduledTask;
  input: TerminalInput;
  submission: TerminalSubmission | null;
  getTabs: () => readonly Tab[];
  getAgent: () => AgentSession | undefined;
}): TaskTerminal | null {
  const { target, task, input, submission } = options;
  const initial = options.getTabs().find((tab) => tab.id === target.tabId);
  const space = target.spaceId ?? initial?.spaceId;
  let agentOwner: Pick<
    AgentSession,
    "startedAt" | "ptyId" | "sessionId"
  > | null = null;
  const current = () => {
    if (!input.current()) return false;
    const tab = options.getTabs().find((value) => value.id === target.tabId);
    if (
      tab?.kind !== "terminal" ||
      tab.private ||
      tab.spaceId !== space ||
      !hasLeaf(tab.paneTree, target.leafId) ||
      (findLeafCwd(tab.paneTree, target.leafId) ?? tab.cwd) !== task.cwd ||
      (input.cwd() !== null && input.cwd() !== task.cwd)
    )
      return false;
    const agent = options.getAgent();
    if (!agent) return !target.agentRunning && agentOwner === null;
    if (
      agent.agent !== task.agent ||
      agent.tabId !== target.tabId ||
      agent.leafId !== target.leafId
    )
      return false;
    if (
      agentOwner &&
      (agentOwner.startedAt !== agent.startedAt ||
        (agentOwner.ptyId !== null && agentOwner.ptyId !== agent.ptyId) ||
        (agentOwner.sessionId !== null &&
          agentOwner.sessionId !== agent.sessionId))
    )
      return false;
    agentOwner ??= {
      startedAt: agent.startedAt,
      ptyId: agent.ptyId,
      sessionId: agent.sessionId,
    };
    if (agentOwner.sessionId === null && agent.sessionId !== null)
      agentOwner.sessionId = agent.sessionId;
    return true;
  };
  if (!current()) return null;
  const assertCurrent = (caller: () => boolean = () => true) => {
    if (!current() || !caller())
      throw new Error("Task terminal is no longer available.");
  };
  return {
    current,
    sessionId: () => {
      const known = current() ? agentOwner?.sessionId : null;
      return isRestorableSessionId(known) ? known : null;
    },
    isReady: () => current() && input.isReady(),
    launch: async (command, caller = () => true, onWriteAttempt) => {
      assertCurrent(caller);
      if (
        !submission ||
        !(await submission.submitWhenReady(
          command,
          15000,
          () => current() && caller(),
          onWriteAttempt,
        ))
      )
        throw new Error("Task terminal is not ready for an agent command.");
      assertCurrent(caller);
    },
    write: async (text, caller = () => true) => {
      assertCurrent(caller);
      await input.write(text, () => current() && caller());
      assertCurrent(caller);
    },
    shiftEnter: async () => {
      assertCurrent();
      const value = await input.shiftEnter();
      assertCurrent();
      return value;
    },
    readBuffer: async (caller = () => true) => {
      assertCurrent(caller);
      const value = await input.readBuffer(60, () => current() && caller());
      assertCurrent(caller);
      return value;
    },
  };
}
