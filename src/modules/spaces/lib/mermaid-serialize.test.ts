import { MAX_MERMAID_SOURCE_BYTES } from "@/modules/mermaid";
import type { Tab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import { hydrateTabs, type SerializedTab, serializeTabs } from "./serialize";

describe("Mermaid tab persistence", () => {
  it("round-trips source and private visual layout without starting a terminal session", () => {
    const tab: Tab = {
      id: 4,
      kind: "mermaid",
      spaceId: "space-a",
      title: "Deployment flow",
      source: "flowchart LR\n  Build --> Deploy",
      visualLayout: {
        kind: "flowchart",
        positions: {
          Build: { x: 80, y: 120 },
          Deploy: { x: 360, y: 120 },
        },
      },
      color: "purple",
    };

    const serialized = serializeTabs([tab]);
    expect(serialized).toEqual([
      {
        kind: "mermaid",
        title: "Deployment flow",
        source: "flowchart LR\n  Build --> Deploy",
        visualLayout: {
          kind: "flowchart",
          positions: {
            Build: { x: 80, y: 120 },
            Deploy: { x: 360, y: 120 },
          },
        },
        color: "purple",
      },
    ]);

    let id = 10;
    const hydrated = hydrateTabs(serialized, "space-a", () => id++);
    expect(hydrated).toEqual([
      {
        id: 10,
        kind: "mermaid",
        spaceId: "space-a",
        cold: true,
        title: "Deployment flow",
        source: "flowchart LR\n  Build --> Deploy",
        visualLayout: {
          kind: "flowchart",
          positions: {
            Build: { x: 80, y: 120 },
            Deploy: { x: 360, y: 120 },
          },
        },
        color: "purple",
      },
    ]);
  });

  it("round-trips an empty editor draft", () => {
    const serialized = [
      { kind: "mermaid", title: "Draft", source: "" },
    ] as SerializedTab[];

    expect(hydrateTabs(serialized, "space-a", () => 7)).toEqual([
      {
        id: 7,
        kind: "mermaid",
        spaceId: "space-a",
        cold: true,
        title: "Draft",
        source: "",
      },
    ]);
  });

  it("round-trips Mermaid source byte-for-byte", () => {
    const source = "\r\nflowchart LR\r\n  A --> B\r\n\r\n";
    const serialized = [
      { kind: "mermaid", title: "Exact", source },
    ] as SerializedTab[];

    const hydrated = hydrateTabs(serialized, "space-a", () => 8);
    expect(hydrated[0]?.kind).toBe("mermaid");
    expect(hydrated[0]?.kind === "mermaid" && hydrated[0].source).toBe(source);
  });

  it("drops oversized persisted Mermaid source", () => {
    const serialized = [
      {
        kind: "mermaid",
        title: "Huge",
        source: "x".repeat(MAX_MERMAID_SOURCE_BYTES + 1),
      },
    ] as SerializedTab[];

    expect(hydrateTabs(serialized, "space-a", () => 1)).toEqual([]);
  });

  it.each([
    { kind: "flowchart", positions: { A: { x: Number.NaN, y: 0 } } },
    {
      kind: "flowchart",
      positions: { A: { x: 0, y: Number.POSITIVE_INFINITY } },
    },
    { kind: "flowchart", positions: { A: { x: 100_001, y: 0 } } },
    { kind: "flowchart", positions: { "invalid id": { x: 0, y: 0 } } },
    { kind: "sequence", positions: { A: { x: 0, y: 0 } } },
  ])(
    "drops a corrupt visual layout without dropping the source",
    (visualLayout) => {
      const serialized = [
        {
          kind: "mermaid",
          title: "Safe source",
          source: "flowchart LR\n  A --> B",
          visualLayout,
        },
      ] as unknown as SerializedTab[];

      expect(hydrateTabs(serialized, "space-a", () => 12)).toEqual([
        {
          id: 12,
          kind: "mermaid",
          spaceId: "space-a",
          cold: true,
          title: "Safe source",
          source: "flowchart LR\n  A --> B",
        },
      ]);
    },
  );
});
