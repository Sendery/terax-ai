import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTask } from "@/modules/tasks/lib/task";
import type { HandoffIo, HandoffResult } from "@/modules/tasks/lib/handoff";
const controls = vi.hoisted(() => ({
  effects: [] as (() => unknown)[],
  state: null as unknown,
  native: {
    workspaceAuthorize: vi.fn(async () => {}),
    piSessionOffset: vi.fn(async () => 0),
    shellBgSpawn: vi.fn(async () => 7),
    shellBgLogs: vi.fn(async () => ({
      next_offset: 0,
      bytes: "",
      exited: true,
      exit_code: 0,
    })),
    piSessionUsage: vi.fn(async () => null),
  },
  cursor: 0,
  slots: [] as { value: unknown }[],
  runHandoff: vi.fn<(io: HandoffIo) => Promise<HandoffResult>>(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: unknown) => {
    const index = controls.cursor++;
    controls.slots[index] ??= { value: { current: value } };
    return controls.slots[index].value;
  },
  useState: (value: unknown) => {
    const index = controls.cursor++;
    controls.slots[index] ??= { value };
    return [
      controls.slots[index].value,
      (update: unknown) => {
        const current = controls.slots[index].value;
        const next =
          typeof update === "function"
            ? (update as (value: unknown) => unknown)(current)
            : update;
        controls.slots[index].value = next;
        controls.state = next;
      },
    ];
  },
  useEffect: (effect: () => unknown) => {
    controls.effects.push(effect);
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (read: () => unknown) => read(),
}));
vi.mock("@/modules/tasks/lib/handoff", async (original) => ({
  ...(await original<typeof import("@/modules/tasks/lib/handoff")>()),
  handOffPrompt: (io: HandoffIo) => controls.runHandoff(io),
}));
vi.mock("@/modules/ai/lib/native", () => ({ native: controls.native }));
const { useTaskDispatcher } = await import(
  "@/modules/tasks/lib/useTaskDispatcher"
);
function DispatcherHarness(agentRunning = true) {
  const task = createTask(
    {
      name: "Public task",
      cwd: "/repo",
      prompt: "one\ntwo",
      schedule: { kind: "manual" },
    },
    100,
  );
  task.failure = { retries: 1, thenDisable: false };
  const io = {
    current: () => true,
    launch: vi.fn(
      async (
        _command: string,
        _current?: () => boolean,
        _attempt?: () => void,
      ) => {},
    ),
    write: vi.fn(async (_data: string) => {}),
    isReady: () => true,
    shiftEnter: async () => "\x1b\r",
    readBuffer: async () => "idle",
    sessionId: () => null as string | null,
  };
  const recordRun = vi.fn(),
    notify = vi.fn();
  const deps = {
    tasks: [task],
    readTasks: () => [task],
    paused: false,
    shellFlavor: "posix" as const,
    recordRun,
    markDispatched: vi.fn((_taskId: string, at: number, claimed?: string) => {
      task.lastRunAt = at;
      task.runCount++;
      if (claimed && !task.sessions.some((entry) => entry.id === claimed))
        task.sessions = [{ id: claimed, cwd: task.cwd }, ...task.sessions];
    }),
    markSessionCreated: vi.fn(
      (_taskId: string, sessionId: string, cwd: string) => {
        if (!task.sessions.some((entry) => entry.id === sessionId))
          task.sessions = [{ id: sessionId, cwd }, ...task.sessions];
      },
    ),
    disableTask: vi.fn(),
    notify,
    ensureTab: async () => ({ tabId: 7, leafId: 70, agentRunning }),
    captureTarget: async () => io,
    openTerminalWith: vi.fn(),
  };
  function DispatcherComponent() {
    controls.cursor = 0;
    controls.effects = [];
    return useTaskDispatcher(deps);
  }
  const api = DispatcherComponent();
  return {
    task,
    api,
    io,
    recordRun,
    notify,
    deps,
    rerender: DispatcherComponent,
  };
}
async function flush() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  controls.effects = [];
  controls.cursor = 0;
  controls.slots = [];
  controls.state = null;
  controls.runHandoff.mockReset();
  for (const method of Object.values(controls.native)) method.mockClear();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("records an unconfirmed written prompt as failed and does not retry that uncertain delivery", async () => {
  controls.runHandoff.mockImplementation(async (io) => {
    await io.write("prompt");
    return { ready: true, attempts: 3, confirmed: false };
  });
  const { task, api, recordRun } = DispatcherHarness();
  api.run(task.id, "manual");
  await flush();
  expect(
    recordRun.mock.calls[recordRun.mock.calls.length - 1]?.[0].status,
  ).toBe("failed");
  expect(vi.getTimerCount()).toBe(0);
});
it("retries a readiness failure before any prompt write", async () => {
  controls.runHandoff
    .mockResolvedValueOnce({ ready: false, attempts: 0, confirmed: false })
    .mockResolvedValue({ ready: true, attempts: 1, confirmed: true });
  const { task, api, recordRun } = DispatcherHarness();
  api.run(task.id, "manual");
  await flush();
  expect(
    recordRun.mock.calls[recordRun.mock.calls.length - 1]?.[0].status,
  ).toBe("failed");
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(30000);
  await flush();
  expect(controls.runHandoff).toHaveBeenCalledTimes(2);
  expect(
    recordRun.mock.calls[recordRun.mock.calls.length - 1]?.[0].status,
  ).toBe("ok");
});

it("admits one handoff and retains one queued occurrence within the same React batch", async () => {
  let finish = (_value: HandoffResult) => {};
  controls.runHandoff.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { task, api } = DispatcherHarness();
  api.run(task.id, "manual");
  api.run(task.id, "manual");
  await flush();
  expect(controls.runHandoff).toHaveBeenCalledOnce();
  expect(controls.state).toMatchObject({ pending: [task.id] });
  finish({ ready: true, attempts: 1, confirmed: true });
  await flush();
  expect(controls.state).toMatchObject({ running: [], pending: [task.id] });
});
it("keeps an independent parallel handoff running when its sibling settles", async () => {
  let finish = (_value: HandoffResult) => {};
  controls.runHandoff
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({ ready: true, attempts: 1, confirmed: true });
  const { task, api } = DispatcherHarness();
  task.overlap = "parallel";
  api.run(task.id, "manual");
  api.run(task.id, "manual");
  await flush();
  const state = controls.state as { running: unknown[] };
  expect(state.running).toHaveLength(1);
  finish({ ready: true, attempts: 1, confirmed: true });
  await flush();
  expect((controls.state as { running: unknown[] }).running).toHaveLength(0);
});

it("does not retry an agent launch that wrote and then lost its acknowledgement", async () => {
  const { task, api, io, recordRun } = DispatcherHarness(false);
  io.launch.mockImplementationOnce(async (_command, _current, attempted) => {
    attempted?.();
    throw new Error("write acknowledgement lost");
  });
  api.run(task.id, "manual");
  await flush();
  expect(
    recordRun.mock.calls[recordRun.mock.calls.length - 1]?.[0].status,
  ).toBe("failed");
  expect(vi.getTimerCount()).toBe(0);
  expect(controls.runHandoff).not.toHaveBeenCalled();
});
it("retries a launch rejected before any write attempt", async () => {
  const { task, api, io } = DispatcherHarness(false);
  io.launch.mockRejectedValueOnce(new Error("shell not ready"));
  api.run(task.id, "manual");
  await flush();
  expect(vi.getTimerCount()).toBe(1);
});
it("keeps readiness retry available after an acknowledged launch but no prompt attempt", async () => {
  controls.runHandoff.mockResolvedValue({
    ready: false,
    attempts: 0,
    confirmed: false,
  });
  const { task, api, io } = DispatcherHarness(false);
  io.launch.mockImplementation(async (_command, _current, attempted) => {
    attempted?.();
  });
  api.run(task.id, "manual");
  await flush();
  expect(vi.getTimerCount()).toBe(1);
});

it("wakes pending sleeps on unmount without a late write or run update", async () => {
  controls.runHandoff.mockImplementation(async (io) => {
    await io.sleep(1000);
    if (io.isCurrent && !io.isCurrent()) throw new Error("retired");
    await io.write("late prompt");
    return { ready: true, attempts: 1, confirmed: true };
  });
  const { task, api, io, recordRun } = DispatcherHarness();
  const cleanup = controls.effects[0]();
  api.run(task.id, "manual");
  await flush();
  expect(vi.getTimerCount()).toBe(1);
  if (typeof cleanup !== "function") throw new Error("cleanup");
  cleanup();
  await flush();
  expect(io.write).not.toHaveBeenCalled();
  expect(recordRun).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("drains one retained pending occurrence after the running handoff settles", async () => {
  let finish = (_value: HandoffResult) => {};
  controls.runHandoff
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({ ready: true, attempts: 1, confirmed: true });
  const { task, api, rerender } = DispatcherHarness();
  api.run(task.id, "manual");
  api.run(task.id, "manual");
  await flush();
  expect(controls.runHandoff).toHaveBeenCalledOnce();
  finish({ ready: true, attempts: 1, confirmed: true });
  await flush();
  rerender();
  controls.effects[1]();
  await flush();
  expect(controls.runHandoff).toHaveBeenCalledTimes(2);
  expect(controls.state).toMatchObject({ running: [], pending: [] });
  rerender();
  controls.effects[1]();
  await flush();
  expect(controls.runHandoff).toHaveBeenCalledTimes(2);
});

it("does not resume an uncreated Claude UUID after a prewrite failure", async () => {
  controls.runHandoff.mockResolvedValue({
    ready: true,
    attempts: 1,
    confirmed: true,
  });
  const { task, api, io, deps } = DispatcherHarness(false);
  task.agent = "claude";
  io.launch.mockRejectedValueOnce(new Error("shell not ready"));
  api.run(task.id, "manual");
  await flush();
  expect(task.sessions).toEqual([]);
  expect(deps.markSessionCreated).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30000);
  await flush();
  expect(io.launch.mock.calls[1][0]).toContain("--session-id");
  expect(io.launch.mock.calls[1][0]).not.toContain("--resume");
});
it("records an acknowledged launch so a later pre-prompt retry resumes its UUID", async () => {
  controls.runHandoff
    .mockResolvedValueOnce({ ready: false, attempts: 0, confirmed: false })
    .mockResolvedValue({ ready: true, attempts: 1, confirmed: true });
  const { task, api, io, deps } = DispatcherHarness(false);
  task.agent = "claude";
  api.run(task.id, "manual");
  await flush();
  expect(deps.markSessionCreated).toHaveBeenCalledExactlyOnceWith(
    task.id,
    task.seed,
    "/repo",
    task.seed,
  );
  await vi.advanceTimersByTimeAsync(30000);
  await flush();
  expect(io.launch.mock.calls[1][0]).toContain("--resume");
});
it("does not claim a created session from an uncertain launch", async () => {
  const { task, api, io, deps } = DispatcherHarness(false);
  io.launch.mockImplementationOnce(async (_command, _current, attempted) => {
    attempted?.();
    throw new Error("acknowledgement lost");
  });
  api.run(task.id, "manual");
  await flush();
  expect(task.sessions).toEqual([]);
  expect(deps.markSessionCreated).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("records the actual known conversation when reusing an existing agent", async () => {
  controls.runHandoff.mockResolvedValue({
    ready: true,
    attempts: 1,
    confirmed: true,
  });
  const known = "11111111-2222-4333-8444-555555555555";
  const { task, api, io, deps, recordRun } = DispatcherHarness(true);
  task.agent = "claude";
  io.sessionId = () => known;
  api.run(task.id, "manual");
  await flush();
  expect(deps.markSessionCreated).toHaveBeenCalledExactlyOnceWith(
    task.id,
    known,
    "/repo",
    task.seed,
  );
  expect(
    recordRun.mock.calls[recordRun.mock.calls.length - 1]?.[0].sessionId,
  ).toBe(known);
});

it("does not restore the old conversation after regeneration during launch acknowledgement", async () => {
  const { task, api, io, deps } = DispatcherHarness(false);
  let finish = () => {};
  const ack = new Promise<void>((resolve) => {
    finish = resolve;
  });
  io.launch.mockImplementation(async (_command, current, attempted) => {
    attempted?.();
    await ack;
    if (!current?.()) throw new Error("retired");
  });
  api.run(task.id, "manual");
  await flush();
  const regenerated = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  task.seed = regenerated;
  task.sessions = [];
  finish();
  await flush();
  expect(task.seed).toBe(regenerated);
  expect(task.sessions).toEqual([]);
  expect(deps.markSessionCreated).not.toHaveBeenCalled();
  expect(io.write).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("does not attach an old headless spawn acknowledgement to a regenerated task", async () => {
  const { task, api, deps } = DispatcherHarness();
  task.target = "headless";
  let finish = (_value: number) => {};
  controls.native.shellBgSpawn.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const cleanup = controls.effects[0]();
  api.run(task.id, "manual");
  await flush();
  const regenerated = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  task.seed = regenerated;
  task.sessions = [];
  finish(7);
  await flush();
  expect(task.seed).toBe(regenerated);
  expect(task.sessions).toEqual([]);
  expect(deps.markSessionCreated).not.toHaveBeenCalled();
  if (typeof cleanup === "function") cleanup();
});

it.each(["tab", "headless"] as const)(
  "does not dispatch a scheduled %s retry into a regenerated conversation",
  async (target) => {
    controls.runHandoff.mockResolvedValue({
      ready: true,
      attempts: 1,
      confirmed: true,
    });
    const { task, api, io, deps } = DispatcherHarness(false);
    task.target = target;
    if (target === "tab")
      io.launch.mockRejectedValueOnce(new Error("prewrite failure"));
    else
      controls.native.workspaceAuthorize.mockRejectedValueOnce(
        new Error("prewrite failure"),
      );
    api.run(task.id, "manual");
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    task.seed = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    task.sessions = [];
    await vi.advanceTimersByTimeAsync(30000);
    await flush();
    expect(deps.markDispatched).toHaveBeenCalledOnce();
    expect(controls.runHandoff).not.toHaveBeenCalled();
    if (target === "tab") expect(io.launch).toHaveBeenCalledOnce();
    else expect(controls.native.workspaceAuthorize).toHaveBeenCalledOnce();
  },
);
