import { expect, it, vi } from "vitest";
import type { AgentSession } from "@/modules/agents/lib/types";
import type { TerminalTab } from "@/modules/tabs/lib/useTabs";
import { createTask } from "@/modules/tasks/lib/task";
import { createTaskTerminal } from "@/modules/tasks/lib/taskTerminal";
import type { TerminalInput } from "@/modules/terminal/lib/terminalInput";

function deferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const task = createTask(
    {
      name: "Public",
      prompt: "one\ntwo",
      cwd: "/repo",
      schedule: { kind: "manual" },
    },
    100,
  );
  const tab: TerminalTab = {
    id: 7,
    kind: "terminal",
    title: "repo",
    spaceId: "space",
    cwd: "/repo",
    activeLeafId: 70,
    paneTree: {
      kind: "split",
      id: 77,
      dir: "row",
      children: [
        { kind: "leaf", id: 70, cwd: "/repo" },
        { kind: "leaf", id: 71, cwd: "/other" },
      ],
    },
  };
  let owner = true;
  let agent: AgentSession | undefined = {
    leafId: 70,
    tabId: 7,
    agent: "pi",
    status: "waiting",
    startedAt: 1,
    lastActivityAt: 1,
    attentionSince: null,
    lastSignal: "attention",
    lastReason: "idle",
    sessionId: null,
    ptyId: 9,
    integration: "pi-extension",
    harness: "pi",
  };
  const writes: string[] = [];
  const input: TerminalInput = {
    current: () => owner,
    cwd: () => "/repo",
    isReady: () => true,
    write: async (text, current) => {
      if (!current?.()) throw new Error("retired");
      writes.push(text);
    },
    shiftEnter: async () => "\x1b[13;2u",
    readBuffer: async () => "public buffer",
  };
  const submission = {
    submitWhenReady: vi.fn(
      async (
        _command: string,
        _timeout: number,
        current?: () => boolean,
        attempted?: () => void,
      ) => {
        if (!current?.()) return false;
        attempted?.();
        return true;
      },
    ),
  };
  const options = {
    target: { tabId: 7, leafId: 70, spaceId: "space", agentRunning: true },
    task,
    input,
    submission,
    getTabs: () => [tab],
    getAgent: () => agent,
  };
  return {
    tab,
    task,
    input,
    writes,
    submission,
    options,
    retire: () => {
      owner = false;
    },
    agent: () => agent,
    setAgent: (next: AgentSession | undefined) => {
      agent = next;
    },
  };
}
it.each(["private", "cwd", "space", "closed-leaf", "owner"])(
  "does not complete a delayed write after %s changes",
  async (kind) => {
    const f = fixture(),
      gate = deferred<void>();
    const terminal = createTaskTerminal(f.options);
    f.input.write = async (text, current) => {
      await gate.promise;
      if (!current?.()) throw new Error("retired");
      f.writes.push(text);
    };
    const result = terminal?.write("prompt");
    const rejected = expect(result).rejects.toThrow("retired");
    if (kind === "private") f.tab.private = true;
    if (kind === "cwd")
      f.tab.paneTree = { kind: "leaf", id: 70, cwd: "/changed" };
    if (kind === "space") f.tab.spaceId = "other-space";
    if (kind === "closed-leaf")
      f.tab.paneTree = { kind: "leaf", id: 71, cwd: "/repo" };
    if (kind === "owner") f.retire();
    gate.resolve();
    await rejected;
    expect(f.writes).toEqual([]);
  },
);
it("keeps the original split target when the user focuses its sibling", async () => {
  const f = fixture(),
    terminal = createTaskTerminal(f.options);
  f.tab.activeLeafId = 71;
  await terminal?.write("original pane");
  expect(f.writes).toEqual(["original pane"]);
  expect(terminal?.current()).toBe(true);
});
it("refuses initial private and wrong-directory targets", () => {
  const f = fixture();
  f.tab.private = true;
  expect(createTaskTerminal(f.options)).toBeNull();
  f.tab.private = false;
  f.tab.paneTree = { kind: "leaf", id: 70, cwd: "/other" };
  expect(createTaskTerminal(f.options)).toBeNull();
  expect(f.writes).toEqual([]);
});
it("discards a buffer returned after privacy changes", async () => {
  const f = fixture(),
    gate = deferred<string>();
  f.input.readBuffer = () => gate.promise;
  const terminal = createTaskTerminal(f.options);
  const read = terminal?.readBuffer();
  const rejected = expect(read).rejects.toThrow("available");
  f.tab.private = true;
  gate.resolve("late private buffer");
  await rejected;
});
it("discards negotiated keys returned after the caller moves the tab", async () => {
  const f = fixture(),
    gate = deferred<string>();
  f.input.shiftEnter = () => gate.promise;
  const terminal = createTaskTerminal(f.options);
  const encoded = terminal?.shiftEnter();
  const rejected = expect(encoded).rejects.toThrow("available");
  f.tab.spaceId = "other";
  gate.resolve("\x1b[13;2u");
  await rejected;
  expect(f.writes).toEqual([]);
});
it("does not reuse a different agent occurrence in the same pane", async () => {
  const f = fixture(),
    terminal = createTaskTerminal(f.options);
  const agent = f.agent();
  if (!agent) throw new Error("fixture");
  f.setAgent({ ...agent, startedAt: 2 });
  expect(terminal?.current()).toBe(false);
  await expect(terminal?.write("stale")).rejects.toThrow("available");
});
it("accepts one initial transcript binding and rejects a later replacement", () => {
  const f = fixture(),
    terminal = createTaskTerminal(f.options);
  const agent = f.agent();
  if (!agent) throw new Error("fixture");
  f.setAgent({ ...agent, sessionId: "first" });
  expect(terminal?.current()).toBe(true);
  expect(terminal?.sessionId()).toBe("first");
  f.setAgent({ ...agent, sessionId: "second" });
  expect(terminal?.current()).toBe(false);
});
it("forwards the launch's actual-write marker through the shell submitter", async () => {
  const f = fixture(),
    attempted = vi.fn();
  f.options.target.agentRunning = false;
  f.setAgent(undefined);
  const terminal = createTaskTerminal(f.options);
  await terminal?.launch("pi --session-id public", () => true, attempted);
  expect(attempted).toHaveBeenCalledOnce();
  expect(f.submission.submitWhenReady).toHaveBeenCalledWith(
    "pi --session-id public",
    15000,
    expect.any(Function),
    attempted,
  );
});

it("does not present a non-restorable agent binding as a known conversation", () => {
  const f = fixture();
  const agent = f.agent();
  if (!agent) throw new Error("fixture");
  f.setAgent({ ...agent, sessionId: "--not-a-conversation" });
  const terminal = createTaskTerminal(f.options);
  expect(terminal?.current()).toBe(true);
  expect(terminal?.sessionId()).toBeNull();
});
