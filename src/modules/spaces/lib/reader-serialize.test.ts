import type { ReaderTab, Tab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import { hydrateTabs, serializeTabs } from "./serialize";

const reader = (over: Partial<ReaderTab> = {}): Tab =>
  ({
    id: 1,
    kind: "reader",
    spaceId: "default",
    title: "articulo.md",
    docId: "a8f92c1d0b3e",
    ...over,
  }) as Tab;

function roundTrip(tabs: Tab[]): Tab[] {
  let next = 100;
  return hydrateTabs(serializeTabs(tabs), "default", () => next++);
}

describe("reader tabs in a space", () => {
  it("survives a restart pointing at the same document, cold", () => {
    expect(roundTrip([reader({ color: "blue" })])[0]).toMatchObject({
      kind: "reader",
      docId: "a8f92c1d0b3e",
      title: "articulo.md",
      cold: true,
      color: "blue",
    });
  });

  it("drops a stored tab whose id is not a library folder name", () => {
    const stored = serializeTabs([reader()]).map((t) => ({
      ...t,
      docId: "../../etc",
    }));
    expect(hydrateTabs(stored, "default", () => 1)).toEqual([]);
  });

  it("keeps a tab's Reader key and docked panel, and drops bad ones", () => {
    const terminal = {
      id: 2,
      kind: "terminal",
      spaceId: "default",
      title: "zsh",
      paneTree: { kind: "leaf", id: 3, cwd: "/a" },
      activeLeafId: 3,
      readerKey: "t0a1b2c3d4e5f",
      readerDock: { docId: "a8f92c1d0b3e", height: 0.5 },
    } as Tab;
    const [back] = roundTrip([terminal]);
    expect(back.readerKey).toBe("t0a1b2c3d4e5f");
    expect(back.readerDock).toEqual({ docId: "a8f92c1d0b3e", height: 0.5 });

    const empty = roundTrip([
      { ...terminal, readerDock: { docId: null, height: 9 } } as Tab,
    ])[0];
    expect(empty.readerDock).toEqual({ docId: null, height: 0.8 });

    const stored = serializeTabs([terminal]).map((t) => ({
      ...t,
      readerKey: "../x",
      readerDock: { docId: "../../etc", height: 0.5 },
    }));
    const [bad] = hydrateTabs(stored, "default", () => 9);
    expect(bad.readerKey).toBeUndefined();
    expect(bad.readerDock).toBeUndefined();
  });
});
