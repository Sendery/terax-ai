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
vi.mock("@/modules/terminal/lib/leafSession", () => ({
  disposeSession: vi.fn(),
}));
import { useTabs } from "@/modules/tabs/lib/useTabs";
import { disposeSession } from "@/modules/terminal/lib/leafSession";
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

it("reuses stable GraphX ids and rejects stale writes before React commits", () => {
  const api = TestHarness();
  const source = JSON.stringify({
    title: "Graph",
    nodes: [{ id: "a", label: "A" }],
    edges: [],
  });
  const first = api.openGraph(source, "owned-graph");
  const second = api.openGraph(source, "owned-graph");
  expect(second).toMatchObject({ created: false, tab: { id: first.tab.id } });
  const update = api.updateGraph(
    "owned-graph",
    first.tab.documentId,
    1,
    source,
  );
  expect(update.revision).toBe(2);
  expect(() =>
    api.updateGraph("owned-graph", first.tab.documentId, 1, source),
  ).toThrow(/revision/);
  expect(api.readGraph("owned-graph").revision).toBe(2);
  api.setGraphPlacement("owned-graph", "left");
  const committed = flush();
  expect(committed.tabs.filter((t) => t.kind === "graphx")).toHaveLength(1);
  expect(committed.readGraph("owned-graph")).toMatchObject({
    placement: "left",
    revision: 2,
  });
  expect(committed.tabs.some((t) => t.kind === "terminal")).toBe(true);
  api.closeTab(first.tab.id);
  const reopened=api.openGraph(source,"owned-graph");
  expect(reopened.tab.documentId).not.toBe(first.tab.documentId);
  expect(()=>api.updateGraph("owned-graph",first.tab.documentId,1,source)).toThrow(/replaced/);
  expect(api.readGraph("owned-graph").revision).toBe(1);
});

it("keeps a dirty Markdown document and metadata while changing views or reopening the file", () => {
  const api = TestHarness();
  const id = api.newMarkdownTab("/repo/readme.md");
  expect(id).not.toBeNull();
  if (id === null) throw new Error("Missing Markdown tab");
  api.updateTab(id, {dirty:true, customTitle:"My notes"});
  for (const mode of ["raw", "side-by-side", "rendered"] as const) api.setRenderableView(id, mode);
  expect(api.openFileTab("/repo/readme.md")).toBe(id);
  const current = flush();
  expect(current.tabs.filter(t => t.kind === "markdown")).toHaveLength(1);
  expect(current.tabs.find(t => t.id === id)).toMatchObject({kind:"markdown",dirty:true,customTitle:"My notes",viewMode:"rendered"});
  current.updateTab(id, {path:"/repo/renamed.md"});
  expect(flush().tabs.find(t => t.id === id)).toMatchObject({path:"/repo/renamed.md",dirty:true});
});

it("closes the detached Agent Flow tab without disposing its terminal", () => {
  const api = TestHarness();
  const terminalId = api.activeId;
  api.openAgentFlowTab();
  const opened = flush();
  const flowId = opened.activeId;

  opened.closeAgentFlowTab(terminalId);
  opened.closeAgentFlowTab(flowId);
  opened.closeAgentFlowTab(flowId);

  const detached = flush();
  expect(detached.tabs).toEqual(api.tabs);
  expect(detached.activeId).toBe(terminalId);
  expect(disposeSession).not.toHaveBeenCalled();
});

it("replaces Agent Flow with a shell if it was the only tab in its space", () => {
  const api = TestHarness();
  api.setActiveSpaceForNewTabs("flow-space");
  api.openAgentFlowTab();
  const opened = flush();
  opened.closeAgentFlowTab(opened.activeId);

  const detached = flush();
  expect(detached.tabs.find((tab) => tab.id === detached.activeId)).toMatchObject({
    kind: "terminal",
    spaceId: "flow-space",
  });
  expect(detached.tabs.map((tab) => tab.kind)).toEqual(["terminal", "terminal"]);
});
