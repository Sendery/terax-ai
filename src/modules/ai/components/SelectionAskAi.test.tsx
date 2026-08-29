import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SelectionAskAi } from "./SelectionAskAi";

describe("SelectionAskAi", () => {
  it("shows Open Mermaid as a semantic action while the popup is open", () => {
    vi.stubGlobal("window", { innerWidth: 1024 });
    const html = renderToStaticMarkup(
      <SelectionAskAi
        state="open"
        x={240}
        y={160}
        onAsk={vi.fn()}
        onAddToNote={vi.fn()}
        onOpenMermaid={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(html).toContain('data-state="open"');
    expect(html).toMatch(/<button[^>]*>.*Open Mermaid.*<\/button>/);
    vi.unstubAllGlobals();
  });
});
