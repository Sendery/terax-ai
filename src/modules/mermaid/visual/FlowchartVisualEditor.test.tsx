import type { FlowchartVisualDocument } from "@/modules/mermaid/lib/visualDocument";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FlowchartVisualEditor,
  pointerDragListeners,
} from "./FlowchartVisualEditor";

const document: FlowchartVisualDocument = {
  kind: "flowchart",
  model: {
    kind: "flowchart",
    direction: "LR",
    nodes: [
      { id: "A", label: "Start", shape: "rounded" },
      { id: "B", label: "Finish", shape: "rectangle" },
    ],
    edges: [
      {
        id: "edge1",
        from: "A",
        to: "B",
        label: "Continue",
        type: "arrow",
      },
    ],
  },
  layout: {
    kind: "flowchart",
    positions: {
      A: { x: 40, y: 40 },
      B: { x: 300, y: 40 },
    },
  },
};

describe("FlowchartVisualEditor", () => {
  it("renders the canvas and accessible structural editing controls", () => {
    const html = renderToStaticMarkup(
      <FlowchartVisualEditor document={document} onCommit={vi.fn()} />,
    );

    expect(html).toContain("Flowchart canvas with 2 nodes and 1 connections");
    expect(html).toContain("Add node");
    expect(html).toContain("Add connection");
    expect(html).toContain("Connections");
    expect(html).toContain('aria-label="Move Start. Press Space to pick up');
    expect(html).toContain("Select a connection");
    expect(html).toContain("A to B");
  });

  it("exposes the supported direction as a form control", () => {
    const html = renderToStaticMarkup(
      <FlowchartVisualEditor document={document} onCommit={vi.fn()} />,
    );

    expect(html).toContain("Diagram direction");
    expect(html).toContain(
      '<option value="LR" selected="">Left to right</option>',
    );
  });

  it("uses its own container width instead of the viewport breakpoint", () => {
    const html = renderToStaticMarkup(
      <FlowchartVisualEditor document={document} onCommit={vi.fn()} />,
    );

    expect(html).toContain("@container/flowchart");
    expect(html).toContain("@5xl/flowchart:flex-row");
    expect(html).not.toContain("lg:flex-row");
  });

  it("gives parallel connections distinct accessible names", () => {
    const parallel: FlowchartVisualDocument = {
      ...document,
      model: {
        ...document.model,
        edges: [
          document.model.edges[0],
          {
            id: "edge2",
            from: "A",
            to: "B",
            label: "Retry",
            type: "dotted",
          },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <FlowchartVisualEditor document={parallel} onCommit={vi.fn()} />,
    );

    expect(html).toContain(
      'aria-label="Connection 1: A to B, arrow, Continue"',
    );
    expect(html).toContain('aria-label="Connection 2: A to B, dotted, Retry"');
  });
});

describe("pointerDragListeners", () => {
  it("keeps pointer activation on the node body", () => {
    const onPointerDown = vi.fn();

    expect(pointerDragListeners({ onPointerDown, onKeyDown: vi.fn() })).toEqual(
      {
        onPointerDown,
      },
    );
  });

  it("never duplicates keyboard activation onto the node body", () => {
    const listeners = pointerDragListeners({
      onPointerDown: vi.fn(),
      onKeyDown: vi.fn(),
    });

    expect("onKeyDown" in listeners).toBe(false);
  });

  it("tolerates a sensor that exposes no pointer handler", () => {
    expect(pointerDragListeners({ onKeyDown: vi.fn() })).toEqual({});
    expect(pointerDragListeners(undefined)).toEqual({});
  });
});

describe("FlowchartVisualEditor drag affordance", () => {
  it("presents the whole node as the pointer drag surface", () => {
    const html = renderToStaticMarkup(
      <FlowchartVisualEditor document={document} onCommit={vi.fn()} />,
    );

    expect(html).toContain("cursor-grab");
  });
});

describe("FlowchartVisualEditor stacked layout", () => {
  it("keeps the inspector scrolling inside the pane instead of growing it", () => {
    const html = renderToStaticMarkup(
      <FlowchartVisualEditor document={document} onCommit={vi.fn()} />,
    );
    const aside = html.slice(
      html.indexOf('aria-label="Flowchart inspector"') - 400,
    );

    // Stacked under the container breakpoint the inspector must be able to
    // shrink and scroll; a shrink-0 aside pushes the whole Mermaid pane,
    // scrolling the Source/Visual toggle out of reach.
    expect(aside).toContain("min-h-0");
    expect(aside).toContain("@5xl/flowchart:flex-none");
    expect(aside).not.toContain("w-full shrink-0 overflow-y-auto");
  });
});
