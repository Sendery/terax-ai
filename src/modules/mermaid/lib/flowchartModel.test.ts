import { describe, expect, it } from "vitest";
import {
  addFlowEdge,
  addFlowNode,
  deleteFlowNode,
  type FlowDirection,
  type FlowEdgeType,
  type FlowNodeShape,
  parseFlowchartVisualSource,
  serializeFlowchartVisualModel,
  updateFlowEdge,
  updateFlowNode,
} from "./flowchartModel";

function parsed(source: string) {
  const result = parseFlowchartVisualSource(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.model;
}

describe("parseFlowchartVisualSource", () => {
  it("parses inline nodes, labels, shapes, direction, and connections", () => {
    const model = parsed(`flowchart LR
  Start([Start]) -->|run| Check{Ready?}
  Check -.-> End[(Store)]`);

    expect(model.direction).toBe("LR");
    expect(model.nodes).toEqual([
      { id: "Start", label: "Start", shape: "stadium" },
      { id: "Check", label: "Ready?", shape: "diamond" },
      { id: "End", label: "Store", shape: "database" },
    ]);
    expect(model.edges).toEqual([
      {
        id: "edge1",
        from: "Start",
        to: "Check",
        label: "run",
        type: "arrow",
      },
      {
        id: "edge2",
        from: "Check",
        to: "End",
        label: "",
        type: "dotted",
      },
    ]);
  });

  it.each<[FlowNodeShape, string]>([
    ["rectangle", 'A["Label"]'],
    ["rounded", 'A("Label")'],
    ["stadium", 'A(["Label"])'],
    ["circle", 'A(("Label"))'],
    ["diamond", 'A{"Label"}'],
    ["hexagon", 'A{{"Label"}}'],
    ["database", 'A[("Label")]'],
    ["subroutine", 'A[["Label"]]'],
  ])("parses and serializes the %s node shape", (shape, declaration) => {
    const model = parsed(`flowchart TB\n  ${declaration}`);
    expect(model.nodes[0]).toEqual({ id: "A", label: "Label", shape });
    expect(serializeFlowchartVisualModel(model)).toContain(`  ${declaration}`);
  });

  it.each([
    ["-->", "arrow"],
    ["---", "open"],
    ["-.->", "dotted"],
    ["==>", "thick"],
  ] as const)("parses and serializes %s connections", (syntax, type) => {
    const model = parsed(`flowchart TB\n  A ${syntax}|label| B`);
    expect(model.edges[0]).toMatchObject({ type, label: "label" });
    expect(serializeFlowchartVisualModel(model)).toContain(
      `  A ${syntax}|label| B`,
    );
  });

  it.each([
    "flowchart LR\n  subgraph cluster\n  A\n  end",
    "flowchart LR\n  classDef red fill:red\n  A",
    "flowchart LR\n  click A callback\n  A",
    "flowchart LR\n  A --> B --> C",
    "flowchart LR\n  %% preserve this comment\n  A",
    "flowchart LR\n  A & B --> C",
  ])("rejects source that cannot be round-tripped without loss", (source) => {
    const result = parseFlowchartVisualSource(source);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate explicit node declarations instead of deduplicating them", () => {
    const result = parseFlowchartVisualSource(
      "flowchart LR\n  A[Alpha]\n  A[Alpha]\n  A --> B",
    );

    expect(result).toEqual({
      ok: false,
      reason: "Duplicate flowchart node declaration: A",
    });
  });
});

describe("flowchart visual mutations", () => {
  it("serializes nodes before edges deterministically", () => {
    const source = serializeFlowchartVisualModel(
      parsed("graph TD\n  B --> A\n  A[Alpha]\n  B[Beta]"),
    );
    expect(source).toBe(`flowchart TD
  B["Beta"]
  A["Alpha"]
  B --> A`);
  });

  it("adds and edits nodes with collision-free ids", () => {
    let model = parsed("flowchart LR\n  node1[Existing]");
    model = addFlowNode(model, { label: "New node", shape: "rounded" });
    expect(model.nodes[model.nodes.length - 1]).toEqual({
      id: "node2",
      label: "New node",
      shape: "rounded",
    });

    model = updateFlowNode(model, "node2", {
      id: "Worker",
      label: "Worker service",
      shape: "database",
    });
    expect(model.nodes[model.nodes.length - 1]).toEqual({
      id: "Worker",
      label: "Worker service",
      shape: "database",
    });
  });

  it("deletes a node and every incident connection", () => {
    const model = deleteFlowNode(
      parsed("flowchart LR\n  A --> B\n  B --> C\n  C --> A"),
      "B",
    );
    expect(model.nodes.map((node) => node.id)).toEqual(["A", "C"]);
    expect(model.edges).toEqual([
      { id: "edge3", from: "C", to: "A", label: "", type: "arrow" },
    ]);
  });

  it("adds and edits connections", () => {
    let model = parsed("flowchart LR\n  A\n  B");
    model = addFlowEdge(model, {
      from: "A",
      to: "B",
      label: "request",
      type: "arrow",
    });
    model = updateFlowEdge(model, "edge1", {
      from: "B",
      to: "A",
      label: "response",
      type: "dotted",
    });
    expect(model.edges).toEqual([
      {
        id: "edge1",
        from: "B",
        to: "A",
        label: "response",
        type: "dotted",
      },
    ]);
  });

  it("round-trips every generated construct through the visual parser", () => {
    const source = serializeFlowchartVisualModel(
      parsed(
        "flowchart LR\n  A([Start]) -->|work| B{Ready?}\n  B ==> C[(Data)]",
      ),
    );
    expect(parseFlowchartVisualSource(source)).toEqual({
      ok: true,
      model: parsed(source),
    });
  });
});

describe("serializeFlowchartVisualModel Mermaid syntax", () => {
  // Mermaid sanitizes every node label through DOMPurify, which is inert
  // without a DOM, and this suite deliberately does not pull one in, so the
  // real parser cannot be driven over labelled nodes here. These goldens pin
  // the exact syntax instead; acceptance by the real parser is verified in the
  // app, where every visual commit is validated by the Mermaid runtime before
  // it touches the source, and by the runtime QA pass documented in
  // docs/mermaid-diagrams.md.
  it.each<[FlowNodeShape, string]>([
    ["rectangle", 'A["Step one"]'],
    ["rounded", 'A("Step one")'],
    ["stadium", 'A(["Step one"])'],
    ["circle", 'A(("Step one"))'],
    ["diamond", 'A{"Step one"}'],
    ["hexagon", 'A{{"Step one"}}'],
    ["database", 'A[("Step one")]'],
    ["subroutine", 'A[["Step one"]]'],
  ])("writes the %s shape as %s", (shape, expected) => {
    const source = serializeFlowchartVisualModel({
      kind: "flowchart",
      direction: "LR",
      nodes: [{ id: "A", label: "Step one", shape }],
      edges: [],
    });

    expect(source).toBe(`flowchart LR\n  ${expected}`);
  });

  it.each<[FlowEdgeType, string]>([
    ["arrow", "-->"],
    ["open", "---"],
    ["dotted", "-.->"],
    ["thick", "==>"],
  ])("writes %s edges as %s", (type, arrow) => {
    const source = serializeFlowchartVisualModel({
      kind: "flowchart",
      direction: "TB",
      nodes: [
        { id: "A", label: "A", shape: "rectangle" },
        { id: "B", label: "B", shape: "rectangle" },
      ],
      edges: [{ id: "e1", from: "A", to: "B", label: "yes", type }],
    });

    expect(source).toContain(`A ${arrow}|yes| B`);
  });

  it.each<FlowDirection>(["TB", "TD", "BT", "RL", "LR"])(
    "writes the %s header",
    (direction) => {
      const source = serializeFlowchartVisualModel({
        kind: "flowchart",
        direction,
        nodes: [{ id: "A", label: "Only", shape: "rounded" }],
        edges: [],
      });

      expect(source).toBe(`flowchart ${direction}\n  A("Only")`);
    },
  );

  it("quotes labels so punctuation cannot reopen Mermaid syntax", () => {
    const source = serializeFlowchartVisualModel({
      kind: "flowchart",
      direction: "LR",
      nodes: [{ id: "A", label: "Ship (v2)", shape: "rectangle" }],
      edges: [],
    });

    expect(source).toBe('flowchart LR\n  A["Ship (v2)"]');
  });

  it("parses a header the real Mermaid parser accepts", async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    await expect(mermaid.parse("flowchart RL\n  A-->B")).resolves.toBeTruthy();
  });
});
