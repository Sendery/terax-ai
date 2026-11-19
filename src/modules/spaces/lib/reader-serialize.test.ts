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
});
