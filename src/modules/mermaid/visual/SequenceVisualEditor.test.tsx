import type { SequenceVisualDocument } from "@/modules/mermaid/lib/visualDocument";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SequenceVisualEditor } from "./SequenceVisualEditor";

const document: SequenceVisualDocument = {
  kind: "sequence",
  model: {
    kind: "sequence",
    participants: [
      { id: "A", label: "Alice", kind: "actor" },
      { id: "B", label: "Backend", kind: "participant" },
    ],
    messages: [
      {
        id: "message1",
        from: "A",
        to: "B",
        text: "Request",
        arrow: "->>",
      },
    ],
  },
};

describe("SequenceVisualEditor", () => {
  it("renders accessible participant and message editing controls", () => {
    const html = renderToStaticMarkup(
      <SequenceVisualEditor document={document} onCommit={vi.fn()} />,
    );

    expect(html).toContain("Sequence participants");
    expect(html).toContain("Messages");
    expect(html).toContain("Add participant");
    expect(html).toContain("Add message");
    expect(html).toContain('aria-label="Drag Alice to reorder"');
    expect(html).toContain('aria-label="Move Alice right"');
    expect(html).toContain('aria-label="Edit Alice"');
    expect(html).toContain('aria-label="Delete Alice and 1 related message"');
    expect(html).toContain('aria-label="Drag Request to reorder"');
    expect(html).toContain('aria-label="Move Request down"');
    expect(html).toContain('aria-label="Edit Request"');
    expect(html).toContain('aria-label="Delete Request"');
  });

  it("explains deletion cleanup and drag keyboard operation", () => {
    const html = renderToStaticMarkup(
      <SequenceVisualEditor document={document} onCommit={vi.fn()} />,
    );

    expect(html).toContain(
      "Deleting a participant also deletes every message connected to it.",
    );
    expect(html).toContain(
      "Use the drag handles with a pointer or press Space and the arrow keys.",
    );
    expect(html).toContain('aria-live="polite"');
  });
});
