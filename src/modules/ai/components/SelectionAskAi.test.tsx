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

it("disables all selection actions while the popup closes", () => {
  const html = renderToStaticMarkup(
    <SelectionAskAi
      state="closed"
      x={0}
      y={0}
      onAsk={vi.fn()}
      onAddToNote={vi.fn()}
      onOpenMermaid={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)];
  expect(buttons).toHaveLength(3);
  expect(buttons.every(([tag]) => tag.includes('disabled=""'))).toBe(true);
});
