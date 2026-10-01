import type { MermaidVisualLayout } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import {
  classifyMermaidVisualSource,
  serializeMermaidVisualDocument,
} from "./visualDocument";

describe("Mermaid visual document classification", () => {
  it("classifies a supported flowchart and normalizes its private layout", () => {
    const result = classifyMermaidVisualSource("flowchart LR\n  A --> B", {
      kind: "flowchart",
      positions: { A: { x: 10, y: 20 }, Stale: { x: 0, y: 0 } },
    });
    expect(result.status).toBe("editable");
    if (result.status !== "editable" || result.document.kind !== "flowchart") {
      throw new Error("Expected an editable flowchart");
    }
    expect(result.document.layout.positions).toEqual({
      A: { x: 10, y: 20 },
      B: { x: 260, y: 40 },
    });
    expect(serializeMermaidVisualDocument(result.document)).toContain(
      "A --> B",
    );
  });

  it("classifies a supported sequence without flow layout metadata", () => {
    const result = classifyMermaidVisualSource(
      "sequenceDiagram\n  A->>B: Hello",
    );
    expect(result.status).toBe("editable");
    if (result.status !== "editable") throw new Error("Expected editable");
    expect(result.document.kind).toBe("sequence");
  });

  it("locks unsupported advanced syntax with its parser reason", () => {
    const result = classifyMermaidVisualSource(
      "sequenceDiagram\n  loop Retry\n  A->>B: Hello\n  end",
    );
    expect(result).toEqual({
      status: "locked",
      reason: "Unsupported sequence statement: loop Retry",
    });
  });

  it("locks every other Mermaid diagram type", () => {
    expect(classifyMermaidVisualSource("classDiagram\n  A <|-- B")).toEqual({
      status: "locked",
      reason:
        "Visual editing currently supports flowcharts and sequence diagrams",
    });
  });

  it("does not accept unrelated sequence layout metadata", () => {
    const layout = {
      kind: "flowchart",
      positions: { Secret: { x: 10, y: 20 } },
    } satisfies MermaidVisualLayout;
    const result = classifyMermaidVisualSource(
      "sequenceDiagram\n  A->>B: Hello",
      layout,
    );
    if (result.status !== "editable" || result.document.kind !== "sequence") {
      throw new Error("Expected sequence");
    }
    expect("layout" in result.document).toBe(false);
  });

  it("locks flowcharts that exceed the visual entity budget", () => {
    const nodes = Array.from(
      { length: 257 },
      (_, index) => `  N${index}["Node ${index}"]`,
    );
    expect(
      classifyMermaidVisualSource(["flowchart LR", ...nodes].join("\n")),
    ).toEqual({
      status: "locked",
      reason: "Visual flowcharts support at most 256 nodes",
    });
  });

  it("locks sequence diagrams that exceed the participant budget", () => {
    const participants = Array.from(
      { length: 129 },
      (_, index) => `  participant P${index}`,
    );
    expect(
      classifyMermaidVisualSource(
        ["sequenceDiagram", ...participants].join("\n"),
      ),
    ).toEqual({
      status: "locked",
      reason: "Visual sequence diagrams support at most 128 participants",
    });
  });
});
