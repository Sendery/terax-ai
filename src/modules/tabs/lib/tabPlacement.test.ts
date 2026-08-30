import { describe, expect, it } from "vitest";
import { moveTabToIndex, setTabPinnedInList, type Tab } from "./useTabs";

function term(id: number, spaceId = "a"): Tab {
  return {
    id,
    kind: "terminal",
    spaceId,
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  } as Tab;
}

function editor(id: number, preview: boolean, spaceId = "a"): Tab {
  return {
    id,
    kind: "editor",
    spaceId,
    title: `f${id}.ts`,
    path: `/repo/f${id}.ts`,
    preview,
    dirty: false,
  } as Tab;
}

const ids = (tabs: readonly Tab[]) => tabs.map((t) => t.id);

describe("moveTabToIndex", () => {
  const tabs = [term(1), term(2), term(3)];

  it("moves a tab to an earlier slot", () => {
    expect(ids(moveTabToIndex(tabs, 3, 0).tabs)).toEqual([3, 1, 2]);
  });

  it("moves a tab to a later slot", () => {
    expect(ids(moveTabToIndex(tabs, 1, 2).tabs)).toEqual([2, 3, 1]);
  });

  it("reports the index the tab ended up at", () => {
    expect(moveTabToIndex(tabs, 1, 2).index).toBe(2);
  });

  it("clamps an index past the end of the strip", () => {
    const moved = moveTabToIndex(tabs, 1, 99);

    expect(ids(moved.tabs)).toEqual([2, 3, 1]);
    expect(moved.index).toBe(2);
  });

  it("counts the index within the tab's own space, not the whole list", () => {
    // Spaces share one array, so a naive splice would move a tab across spaces.
    const mixed = [term(1, "a"), term(2, "b"), term(3, "a")];
    const moved = moveTabToIndex(mixed, 3, 0);

    expect(ids(moved.tabs.filter((t) => t.spaceId === "a"))).toEqual([3, 1]);
    expect(moved.tabs.find((t) => t.id === 2)?.spaceId).toBe("b");
  });

  it("is a no-op for an unknown tab", () => {
    expect(moveTabToIndex(tabs, 99, 0)).toEqual({ tabs, index: null });
  });
});

describe("setTabPinnedInList", () => {
  it("pins a preview editor tab", () => {
    const tabs = [editor(1, true)];
    const next = setTabPinnedInList(tabs, 1, true);

    expect(next.changed).toBe(true);
    expect((next.tabs[0] as { preview: boolean }).preview).toBe(false);
  });

  it("returns an editor tab to the preview slot", () => {
    const tabs = [editor(1, false)];
    const next = setTabPinnedInList(tabs, 1, false);

    expect((next.tabs[0] as { preview: boolean }).preview).toBe(true);
  });

  it("keeps a single preview slot per space", () => {
    // Two preview tabs would both claim the slot the next opened file replaces.
    const tabs = [editor(1, true), editor(2, false)];
    const next = setTabPinnedInList(tabs, 2, false);

    expect(next.tabs.map((t) => (t as { preview: boolean }).preview)).toEqual([
      false,
      true,
    ]);
  });

  it("leaves the preview slot of another space alone", () => {
    const tabs = [editor(1, true, "a"), editor(2, false, "b")];
    const next = setTabPinnedInList(tabs, 2, false);

    expect((next.tabs[0] as { preview: boolean }).preview).toBe(true);
  });

  it("refuses a tab kind that has no preview slot", () => {
    const tabs = [term(1)];

    expect(setTabPinnedInList(tabs, 1, true)).toEqual({ tabs, changed: false });
  });

  it("is a no-op for an unknown tab", () => {
    const tabs = [editor(1, true)];

    expect(setTabPinnedInList(tabs, 99, true)).toEqual({
      tabs,
      changed: false,
    });
  });
});
