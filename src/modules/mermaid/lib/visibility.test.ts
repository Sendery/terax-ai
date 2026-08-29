import type { MermaidTab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import { selectMountedMermaidTabs } from "./visibility";

function tab(id: number, cold = false): MermaidTab {
  return {
    id,
    kind: "mermaid",
    spaceId: "space-a",
    title: `Diagram ${id}`,
    source: "flowchart LR\nA-->B",
    ...(cold ? { cold: true } : {}),
  };
}

describe("selectMountedMermaidTabs", () => {
  it("selects only the active non-cold Mermaid tab", () => {
    expect(selectMountedMermaidTabs([tab(1), tab(2), tab(3, true)], 2)).toEqual(
      [tab(2)],
    );
    expect(selectMountedMermaidTabs([tab(1, true), tab(2)], 1)).toEqual([]);
  });
});
