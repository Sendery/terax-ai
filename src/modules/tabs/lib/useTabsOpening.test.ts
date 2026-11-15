import { beforeEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as { value: unknown }[],
  pending: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const at = hooks.cursor++;
    if (!hooks.slots[at])
      hooks.slots[at] = {
        value:
          typeof initial === "function"
            ? (initial as () => unknown)()
            : initial,
      };
    return [
      hooks.slots[at].value,
      (action: unknown) => {
        hooks.pending.push(() => {
          hooks.slots[at].value =
            typeof action === "function"
              ? (action as (value: unknown) => unknown)(hooks.slots[at].value)
              : action;
        });
      },
    ];
  },
  useRef: (initial: unknown) => {
    const at = hooks.cursor++;
    if (!hooks.slots[at]) hooks.slots[at] = { value: { current: initial } };
    return hooks.slots[at].value;
  },
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  startTransition: (work: () => void) => work(),
}));
vi.mock("@/modules/terminal/lib/useTerminalSession", () => ({
  disposeSession: vi.fn(),
}));
import { useTabs } from "@/modules/tabs/lib/useTabs";
function TestHarness() {
  hooks.cursor = 0;
  return useTabs();
}
function flush() {
  while (hooks.pending.length) hooks.pending.shift()?.();
  return TestHarness();
}
beforeEach(() => {
  hooks.cursor = 0;
  hooks.slots = [];
  hooks.pending = [];
});
it("creates and activates the last requested file with deferred batched React updates", () => {
  const tabs = TestHarness();
  const first = tabs.openFileTab("/repo/first.ts", true);
  const second = tabs.openFileTab("/repo/second.ts", true);
  expect(first).toEqual(expect.any(Number));
  expect(second).toEqual(expect.any(Number));
  expect(second).not.toBe(first);
  const committed = flush();
  expect(committed.activeId).toBe(second);
  expect(
    committed.tabs
      .filter((tab) => tab.kind === "editor")
      .map((tab) => tab.path),
  ).toEqual(["/repo/first.ts", "/repo/second.ts"]);
});
it("reuses a persistent editor opened twice before the same batch commits", () => {
  const tabs = TestHarness();
  const first = tabs.openFileTab("/repo/file.ts", true);
  const second = tabs.openFileTab("/repo/file.ts", true);
  expect(first).toEqual(expect.any(Number));
  expect(second).toBe(first);
  const committed = flush();
  expect(committed.activeId).toBe(first);
  expect(committed.tabs.filter((tab) => tab.kind === "editor")).toHaveLength(1);
});
it("preserves an earlier pending tab mutation while opening an editor", () => {
  const tabs = TestHarness();
  tabs.updateTab(1, { title: "kept" });
  const id = tabs.openFileTab("/repo/file.ts", true);
  const committed = flush();
  expect(committed.tabs.find((tab) => tab.id === 1)?.title).toBe("kept");
  expect(committed.activeId).toBe(id);
});
