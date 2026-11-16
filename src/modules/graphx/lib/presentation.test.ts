import type { GraphTab, TerminalTab } from "@/modules/tabs";
import { expect, it } from "vitest";
import { graphDockMargins, visibleGraph } from "./presentation";

const terminal: TerminalTab = {
  id: 1,
  kind: "terminal",
  title: "shell",
  spaceId: "s",
  paneTree: { kind: "leaf", id: 2 },
  activeLeafId: 2,
};
const graph: GraphTab = {
  id: 3,
  kind: "graphx",
  title: "Graph",
  spaceId: "s",
  graphId: "graph",
  documentId: "00000000-0000-4000-8000-000000000001",
  source: "{}",
  revision: 1,
  placement: "right",
};
it("keeps the real terminal alongside its docked graph with matching reserved width", () => {
  expect(visibleGraph([terminal, graph], terminal)).toBe(graph);
  expect(graphDockMargins([terminal, graph], terminal)).toEqual({
    marginLeft: undefined,
    marginRight: "min(560px, 60%)",
  });
  expect(graphDockMargins([terminal, graph], graph)).toEqual({});
  expect(
    graphDockMargins([terminal, { ...graph, placement: "floating" }], terminal),
  ).toEqual({ marginLeft: undefined, marginRight: undefined });
  expect(
    visibleGraph([terminal, { ...graph, spaceId: "elsewhere" }], terminal),
  ).toBeUndefined();
});

it("hides companions and reserves no width for private terminals while keeping the graph tab available", () => {
  const privateTerminal: TerminalTab = { ...terminal, private: true };
  for (const placement of ["left", "right", "floating"] as const) {
    const companion: GraphTab = { ...graph, placement };
    const tabs = [privateTerminal, companion];
    expect(visibleGraph(tabs, privateTerminal)).toBeUndefined();
    expect(graphDockMargins(tabs, privateTerminal)).toEqual({});
    expect(visibleGraph(tabs, companion)).toBe(companion);
    expect(graphDockMargins(tabs, companion)).toEqual({});
  }
});
