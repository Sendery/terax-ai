import { describe, expect, it } from "vitest";
import {
  canLivePreviewMermaidSource,
  MAX_MERMAID_LIVE_PREVIEW_BYTES,
  MAX_MERMAID_SOURCE_BYTES,
  normalizeMermaidSource,
  validateMermaidDraftSource,
  validateMermaidSource,
} from "./source";

describe("normalizeMermaidSource", () => {
  it("unwraps a selected fenced Mermaid block and normalizes line endings", () => {
    expect(
      normalizeMermaidSource(
        "  ```mermaid\r\nflowchart LR\r\n  A --> B\r\n```  ",
      ),
    ).toBe("flowchart LR\n  A --> B");
  });

  it("preserves a bare Mermaid document apart from surrounding whitespace", () => {
    expect(normalizeMermaidSource("\nsequenceDiagram\n  A->>B: Hello\n")).toBe(
      "sequenceDiagram\n  A->>B: Hello",
    );
  });
});

describe("canLivePreviewMermaidSource", () => {
  it("allows the live preview boundary", () => {
    expect(
      canLivePreviewMermaidSource("x".repeat(MAX_MERMAID_LIVE_PREVIEW_BYTES)),
    ).toBe(true);
  });

  it("pauses live preview above the UTF-8 byte boundary", () => {
    const source = `${"x".repeat(MAX_MERMAID_LIVE_PREVIEW_BYTES - 2)}€`;
    expect(canLivePreviewMermaidSource(source)).toBe(false);
  });
});

describe("validateMermaidSource", () => {
  it("rejects empty source", () => {
    expect(validateMermaidSource("   \n")).toEqual({
      ok: false,
      message: "Mermaid source cannot be empty",
    });
  });

  it("rejects source too large for the authenticated Pi bridge", () => {
    expect(
      validateMermaidSource("x".repeat(MAX_MERMAID_SOURCE_BYTES + 1)),
    ).toEqual({
      ok: false,
      message: `Mermaid source exceeds ${MAX_MERMAID_SOURCE_BYTES} UTF-8 bytes`,
    });
  });

  it("returns normalized valid source", () => {
    expect(
      validateMermaidSource("```mermaid\nflowchart TD\nA-->B\n```"),
    ).toEqual({ ok: true, source: "flowchart TD\nA-->B" });
  });
});

describe("validateMermaidDraftSource", () => {
  it("preserves persisted editor bytes exactly", () => {
    const source = "\r\nflowchart LR\r\n  A --> B\r\n\r\n";
    expect(validateMermaidDraftSource(source)).toEqual({ ok: true, source });
  });
});
