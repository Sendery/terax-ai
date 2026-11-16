import { expect, it } from "vitest";
import {
  hydrateTabs,
  serializeTabs,
  type SerializedTab,
} from "@/modules/spaces/lib/serialize";
import { resolveViewMode, VIEW_MODES } from "@/modules/renderable/viewMode";
import type { Tab } from "@/modules/tabs";
it("round-trips all view modes and preserves source, path and identity metadata", () => {
  const tabs: Tab[] = [
    {
      id: 1,
      kind: "editor",
      spaceId: "s",
      title: "html",
      path: "/index.html",
      dirty: false,
      preview: false,
    },
    { id: 2, kind: "markdown", spaceId: "s", title: "md", path: "/doc.md" },
    {
      id: 3,
      kind: "mermaid",
      spaceId: "s",
      title: "mmd",
      source: "graph TD; A-->B",
    },
    {
      id: 4,
      kind: "graphx",
      spaceId: "s",
      title: "g",
      graphId: "g",
      documentId: "00000000-0000-4000-8000-000000000000",
      revision: 2,
      placement: "tab",
      source: JSON.stringify({
        title: "g",
        nodes: [{ id: "a", label: "A" }],
        edges: [],
      }),
    },
  ];
  for (const viewMode of VIEW_MODES) {
    let next = 10;
    const stored = serializeTabs(tabs.map((t) => ({ ...t, viewMode })));
    const restored = hydrateTabs(stored, "s", () => next++);
    expect(restored).toHaveLength(tabs.length);
    expect(restored.map(resolveViewMode)).toEqual(tabs.map(() => viewMode));
    expect(serializeTabs(restored)).toEqual(stored);
  }
});
it("ignores malformed modes while keeping legacy documents", () => {
  for (const viewMode of [undefined, null, "invalid", 42, {}]) {
    let next = 10;
    const restored = hydrateTabs(
      [
        {
          kind: "markdown",
          path: "/readme.md",
          viewMode,
        } as unknown as SerializedTab,
      ],
      "s",
      () => next++,
    );
    expect(restored).toHaveLength(1);
    expect(resolveViewMode(restored[0])).toBe("rendered");
  }
});
