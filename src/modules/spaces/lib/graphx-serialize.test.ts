import { expect, it } from "vitest";
import { replaceGraph } from "@/modules/graphx/lib/document";
import { applyTabPatch, labelFor, type GraphTab } from "@/modules/tabs";
import {
  hydrateTabs,
  serializeTabs,
  type SerializedTab,
} from "@/modules/spaces/lib/serialize";

const source = (title: string) =>
  JSON.stringify({ title, nodes: [{ id: "a", label: "A" }], edges: [] });
const graph: GraphTab = {
  id: 1,
  kind: "graphx",
  spaceId: "space",
  title: "System",
  source: source("System"),
  graphId: "system",
  documentId: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  placement: "right",
};
function restore(raw: SerializedTab[]): GraphTab {
  const [tab] = hydrateTabs(
    JSON.parse(JSON.stringify(raw)),
    "restored",
    () => 10,
  );
  expect(tab?.kind).toBe("graphx");
  return tab as GraphTab;
}
function update(tab: GraphTab): GraphTab {
  return replaceGraph(
    [tab],
    tab.graphId,
    tab.documentId,
    tab.revision,
    source("Updated system"),
  )[0] as GraphTab;
}
it.each(["My board", "System"])(
  "keeps renamed label %s separate from the graph title across restore and source update",
  (customTitle) => {
    const renamed = applyTabPatch(graph, { customTitle });
    const saved = serializeTabs([renamed]);
    expect(saved[0]).toMatchObject({ title: "System", customTitle });
    const restored = restore(saved);
    const updated = update(restored);
    expect(updated.title).toBe("Updated system");
    expect(labelFor(updated)).toBe(customTitle);
  },
);
it("resetTitle after restore returns to the source title and stays reset through another save and update", () => {
  const restored = restore(
    serializeTabs([applyTabPatch(graph, { customTitle: "My board" })]),
  );
  const reset = applyTabPatch(restored, { customTitle: "" });
  expect(labelFor(reset)).toBe("System");
  const saved = serializeTabs([reset]);
  expect(saved[0]).not.toHaveProperty("customTitle");
  expect(labelFor(update(restore(saved)))).toBe("Updated system");
});
it("migrates a legacy flattened custom title without turning an ordinary source title into a custom label", () => {
  const [raw] = serializeTabs([graph]);
  const legacy = { ...raw, title: "Legacy board" };
  const restored = restore([legacy as SerializedTab]);
  expect(restored.title).toBe("System");
  expect(restored.customTitle).toBe("Legacy board");
  expect(labelFor(update(restored))).toBe("Legacy board");
  expect(restore([raw]).customTitle).toBeUndefined();
  expect(labelFor(update(restore([raw])))).toBe("Updated system");
});
it.each([42, null, {}, "", "  "])(
  "ignores corrupt explicit custom title %j without guessing a legacy name",
  (customTitle) => {
    const [raw] = serializeTabs([graph]);
    const restored = restore([
      {
        ...raw,
        title: "Untrusted stale title",
        customTitle,
      } as unknown as SerializedTab,
    ]);
    expect(restored.title).toBe("System");
    expect(restored.customTitle).toBeUndefined();
    expect(labelFor(update(restored))).toBe("Updated system");
  },
);
it("bounds restored custom titles and falls back to source for a corrupt legacy title", () => {
  const [raw] = serializeTabs([graph]);
  expect(
    restore([{ ...raw, customTitle: "x".repeat(10000) } as SerializedTab])
      .customTitle,
  ).toBe("x".repeat(80));
  const invalid = restore([{ ...raw, title: 42 } as unknown as SerializedTab]);
  expect(invalid.title).toBe("System");
  expect(invalid.customTitle).toBeUndefined();
});
