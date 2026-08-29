import { describe, expect, it, vi } from "vitest";
import { classifyMermaidVisualSource } from "./visualDocument";
import { prepareMermaidVisualTransaction } from "./visualTransaction";

function flowDocument() {
  const result = classifyMermaidVisualSource("flowchart LR\n  A --> B");
  if (result.status !== "editable" || result.document.kind !== "flowchart") {
    throw new Error("Expected editable flowchart");
  }
  return result.document;
}

describe("prepareMermaidVisualTransaction", () => {
  it("reparses and validates generated source before making it publishable", async () => {
    const validateRuntime = vi.fn(async () => undefined);

    const result = await prepareMermaidVisualTransaction(
      flowDocument(),
      validateRuntime,
    );

    expect(validateRuntime).toHaveBeenCalledWith(result.source);
    expect(result.source).toContain("A --> B");
    expect(result.visualLayout?.kind).toBe("flowchart");
  });

  it("rejects the entire transaction when the real runtime rejects generated source", async () => {
    const validateRuntime = vi.fn(async () => {
      throw new Error("Mermaid parser rejected generated source");
    });

    await expect(
      prepareMermaidVisualTransaction(flowDocument(), validateRuntime),
    ).rejects.toThrow("Mermaid parser rejected generated source");
  });
});
