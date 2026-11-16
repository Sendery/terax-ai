import type { GraphTab, Tab, TerminalTab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import {
  graphPlacementTarget,
  rememberGraphTerminalFocus,
} from "./placementFocus";

function terminal(
  id: number,
  spaceId = "work",
  privateTerminal = false,
): TerminalTab {
  return {
    id,
    kind: "terminal",
    title: "shell",
    spaceId,
    private: privateTerminal,
    paneTree: { kind: "leaf", id: id + 1000 },
    activeLeafId: id + 1000,
  };
}

const graph: GraphTab = {
  id: 90,
  kind: "graphx",
  title: "Graph",
  spaceId: "work",
  graphId: "system",
  documentId: "00000000-0000-4000-8000-000000000001",
  source: "{}",
  revision: 1,
  placement: "tab",
};
const tabs: Tab[] = [
  terminal(7),
  terminal(35),
  terminal(50, "other"),
  terminal(60, "work", true),
  graph,
];
const remembered = new Map([["work", 35]]);

describe("GraphX placement target", () => {
  it.each(["left", "right", "floating"] as const)(
    "keeps the chosen public terminal for %s instead of the first tab",
    (placement) => {
      expect(graphPlacementTarget(tabs, graph, placement, 35, new Map())).toBe(
        35,
      );
    },
  );

  it("prefers the current terminal over an older remembered choice", () => {
    expect(
      graphPlacementTarget(tabs, graph, "floating", 35, new Map([["work", 7]])),
    ).toBe(35);
  });

  it("focuses the graph for explicit tab placement", () => {
    expect(graphPlacementTarget(tabs, graph, "tab", 35, remembered)).toBe(90);
  });

  it("returns from a full graph tab to its space's remembered terminal", () => {
    expect(
      graphPlacementTarget(tabs, graph, "right", graph.id, remembered),
    ).toBe(35);
  });

  it("uses the graph space's memory when another space is active", () => {
    expect(
      graphPlacementTarget(
        tabs,
        graph,
        "left",
        50,
        new Map([
          ["work", 35],
          ["other", 50],
        ]),
      ),
    ).toBe(35);
  });

  it.each([
    ["closed", 999],
    ["in another space", 50],
    ["private", 60],
    ["a graph", graph.id],
  ] as const)("revalidates a remembered tab that is %s", (_label, id) => {
    expect(
      graphPlacementTarget(
        tabs,
        graph,
        "floating",
        graph.id,
        new Map([["work", id]]),
      ),
    ).toBe(7);
  });

  it("never chooses the active private terminal", () => {
    expect(graphPlacementTarget(tabs, graph, "left", 60, remembered)).toBe(35);
  });

  it("falls back within the graph space rather than the active space", () => {
    expect(graphPlacementTarget(tabs, graph, "right", 50, new Map())).toBe(7);
  });

  it("retains the graph when no public terminal exists in its space", () => {
    const unavailable = [
      terminal(50, "other"),
      terminal(60, "work", true),
      graph,
    ];
    expect(
      graphPlacementTarget(unavailable, graph, "floating", 60, remembered),
    ).toBe(graph.id);
    expect(unavailable.map((tab) => tab.id)).toEqual([50, 60, graph.id]);
  });

  it("validates current tabs instead of trusting previously stored public IDs", () => {
    const nowPrivate = tabs.map((tab) =>
      tab.id === 35 ? terminal(35, "work", true) : tab,
    );
    expect(
      graphPlacementTarget(nowPrivate, graph, "floating", graph.id, remembered),
    ).toBe(7);
  });
});

describe("GraphX terminal focus memory", () => {
  it("remembers the most recent public choice across full graph activation", () => {
    const previous = new Map([["work", 7]]);
    const focused = rememberGraphTerminalFocus(tabs, 35, previous);
    const fullGraph = rememberGraphTerminalFocus(tabs, graph.id, focused);
    expect(fullGraph.get("work")).toBe(35);
    expect(
      graphPlacementTarget(tabs, graph, "right", graph.id, fullGraph),
    ).toBe(35);
    expect(previous.get("work")).toBe(7);
  });

  it("keeps independent public choices per space", () => {
    const first = rememberGraphTerminalFocus(tabs, 35, new Map());
    const second = rememberGraphTerminalFocus(tabs, 50, first);
    expect([...second]).toEqual([
      ["work", 35],
      ["other", 50],
    ]);
    expect(first.has("other")).toBe(false);
  });

  it("does not remember private focus or discard an earlier public choice", () => {
    expect([...rememberGraphTerminalFocus(tabs, 60, remembered)]).toEqual([
      ["work", 35],
    ]);
    expect([...rememberGraphTerminalFocus(tabs, 60, new Map())]).toEqual([]);
  });

  it("lets the active choice win even when an old choice appears later in tab order", () => {
    const previous = new Map([["work", 7]]);
    const reordered = [terminal(35), terminal(7), graph];
    expect(
      rememberGraphTerminalFocus(reordered, 35, previous).get("work"),
    ).toBe(35);
  });

  it("drops closed, moved, private and nonterminal entries without mutating memory", () => {
    const previous = new Map([
      ["work", 999],
      ["moved", 50],
      ["private-space", 61],
      ["graph-space", 91],
      ["other", 50],
    ]);
    const current = [
      ...tabs,
      terminal(61, "private-space", true),
      { ...graph, id: 91, spaceId: "graph-space" },
    ];
    expect([
      ...rememberGraphTerminalFocus(current, graph.id, previous),
    ]).toEqual([["other", 50]]);
    expect(previous.size).toBe(5);
  });
});
