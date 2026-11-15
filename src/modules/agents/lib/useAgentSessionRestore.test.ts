import { beforeEach, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs";
import type { SavedAgentSession } from "@/modules/agents/lib/restore";

const controls = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effects: [] as (() => unknown)[],
  snapshot: Promise.resolve(null) as Promise<unknown>,
  readiness: Promise.resolve(),
  ready: true,
  submit: vi.fn<(leaf: number, text: string) => Promise<void>>(),
  clear: vi.fn(async () => {}),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => {
    const index = controls.index++;
    controls.values[index] = value;
    return [
      value,
      (next: unknown) => {
        controls.values[index] = next;
      },
    ];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => {
    controls.effects.push(effect);
  },
}));
vi.mock("@/modules/terminal", async () => {
  const panes = await import("@/modules/terminal/lib/panes");
  return {
    ...panes,
    whenSessionReady: () => controls.readiness,
    submitToLeaf: controls.submit,
    captureLeafSubmission: (leaf: number) => ({
      submitWhenReady: async (
        text: string,
        _timeout: number,
        current: () => boolean,
      ) => {
        await controls.readiness;
        if (!controls.ready || !current()) return false;
        try {
          await controls.submit(leaf, text);
          return current();
        } catch {
          return false;
        }
      },
    }),
  };
});
vi.mock("@/modules/agents/lib/restoreStore", () => ({
  clearRestoreSnapshot: controls.clear,
  readRestoreSnapshot: () => controls.snapshot,
}));
const { useAgentSessionRestore } = await import(
  "@/modules/agents/lib/useAgentSessionRestore"
);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const saved: SavedAgentSession = {
  agent: "claude",
  sessionId: "9f1c4d2e-0000-4000-8000-000000000000",
  cwd: "/repo",
  spaceId: "space",
  tabIndex: 0,
  leafIndex: 0,
  tabTitle: "repo",
  startedAt: 100,
};
function RestoreHarness(policy: "ask" | "always" = "ask") {
  const tab: Tab = {
    id: 10,
    kind: "terminal",
    title: "repo",
    spaceId: "space",
    cwd: "/repo",
    activeLeafId: 100,
    paneTree: { kind: "leaf", id: 100, cwd: "/repo" },
  };
  let tabs: Tab[] = [tab];
  const api = useAgentSessionRestore({
    ready: true,
    policy,
    shellFlavor: "posix",
    getTabs: () => tabs,
    knownSpaceIds: () => ["space"],
    activeSpaceId: () => "space",
    newTabInSpace: vi.fn(() => 20),
    warmTab: vi.fn(),
    setActiveId: vi.fn(),
  });
  return {
    api,
    tab,
    replace: (next: Tab[]) => {
      tabs = next;
    },
  };
}
beforeEach(() => {
  controls.index = 0;
  controls.values = [];
  controls.effects = [];
  controls.snapshot = Promise.resolve(null);
  controls.readiness = Promise.resolve();
  controls.ready = true;
  controls.submit.mockReset().mockResolvedValue(undefined);
  controls.clear.mockClear();
});
it.each(["private", "closed", "cwd", "leaf"])(
  "does not resume after its target becomes %s during readiness",
  async (kind) => {
    const ready = deferred();
    controls.readiness = ready.promise;
    const { api, tab, replace } = RestoreHarness();
    api.restore([saved]);
    if (kind === "private") tab.private = true;
    if (kind === "closed") replace([]);
    if (kind === "cwd" && tab.kind === "terminal")
      tab.paneTree = { kind: "leaf", id: 100, cwd: "/other" };
    if (kind === "leaf" && tab.kind === "terminal")
      tab.paneTree = { kind: "leaf", id: 101, cwd: "/repo" };
    ready.resolve();
    await tick();
    expect(controls.submit).not.toHaveBeenCalled();
  },
);
it("keeps capture unsettled until the asynchronous native submission completes", async () => {
  const sent = deferred();
  controls.submit.mockReturnValue(sent.promise);
  const { api } = RestoreHarness();
  api.restore([saved]);
  await tick();
  expect(controls.values[1]).toBe(false);
  expect(controls.clear).not.toHaveBeenCalled();
  sent.resolve();
  await tick();
  expect(controls.values[1]).toBe(true);
  expect(controls.clear).toHaveBeenCalledOnce();
});
it("does not send twice when restore is called again while readiness is pending", async () => {
  const ready = deferred();
  controls.readiness = ready.promise;
  const { api } = RestoreHarness();
  api.restore([saved]);
  api.restore([saved]);
  ready.resolve();
  await tick();
  expect(controls.submit).toHaveBeenCalledOnce();
});
it("cancels pending readiness when restoration is dismissed", async () => {
  const ready = deferred();
  controls.readiness = ready.promise;
  const { api } = RestoreHarness();
  api.restore([saved]);
  api.dismiss();
  ready.resolve();
  await tick();
  expect(controls.submit).not.toHaveBeenCalled();
});
it("keeps failed submissions available instead of clearing their recovery snapshot", async () => {
  controls.submit.mockRejectedValue(new Error("closed terminal"));
  const { api } = RestoreHarness();
  api.restore([saved]);
  await tick();
  expect(controls.values[0]).toEqual([saved]);
  expect(controls.values[1]).toBe(false);
  expect(controls.clear).not.toHaveBeenCalled();
});

it.each(["ask", "always"] as const)(
  "ignores a late boot snapshot after dismiss under policy %s",
  async (policy) => {
    let finish = (_snapshot: unknown) => {};
    controls.snapshot = new Promise((resolve) => {
      finish = resolve;
    });
    const { api } = RestoreHarness(policy);
    controls.effects.forEach((effect) => {
      effect();
    });
    api.dismiss();
    finish({ version: 1, savedAt: 1, sessions: [saved] });
    await tick();
    expect(controls.submit).not.toHaveBeenCalled();
    expect(controls.values[0]).toEqual([]);
    expect(controls.values[1]).toBe(true);
  },
);

it("restarts boot recovery safely after effect setup and cleanup replay", async () => {
  let finish = (_snapshot: unknown) => {};
  controls.snapshot = new Promise((resolve) => {
    finish = resolve;
  });
  RestoreHarness("always");
  const cleanups = controls.effects.map((effect) => effect());
  cleanups.forEach((cleanup) => {
    if (typeof cleanup === "function") cleanup();
  });
  controls.effects.forEach((effect) => {
    effect();
  });
  finish({ version: 1, savedAt: 1, sessions: [saved] });
  await tick();
  expect(controls.submit).toHaveBeenCalledExactlyOnceWith(
    100,
    "cd /repo && claude --resume 9f1c4d2e-0000-4000-8000-000000000000",
  );
  expect(controls.values[1]).toBe(true);
});

it("waits for recovery snapshot deletion before enabling capture", async () => {
  const cleared = deferred();
  controls.clear.mockReturnValueOnce(cleared.promise);
  const { api } = RestoreHarness();
  api.restore([saved]);
  await tick();
  expect(controls.submit).toHaveBeenCalledOnce();
  expect(controls.values[1]).toBe(false);
  cleared.resolve();
  await tick();
  expect(controls.values[1]).toBe(true);
});
