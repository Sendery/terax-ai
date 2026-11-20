import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { popupHeight, SelectionAskAi } from "./SelectionAskAi";

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

describe("SelectionAskAi reading actions", () => {
  const noop = () => {};

  it("offers Read here, Read in new tab and Speak with the menus' labels", () => {
    const html = renderToStaticMarkup(
      <SelectionAskAi
        state="closed"
        x={100}
        y={100}
        onAsk={noop}
        onAddToNote={noop}
        onOpenMermaid={noop}
        reading={{ onReadHere: noop, onReadInNewTab: noop, onSpeak: noop }}
        onDismiss={noop}
      />,
    );
    for (const label of ["Read here", "Read in new tab", "Speak"])
      expect(html).toContain(label);
    expect([...html.matchAll(/<button\b[^>]*>/g)]).toHaveLength(6);
  });

  it("leaves reading out where it is off, such as a private terminal", () => {
    const html = renderToStaticMarkup(
      <SelectionAskAi
        state="closed"
        x={100}
        y={100}
        onAsk={noop}
        onAddToNote={noop}
        onOpenMermaid={noop}
        onDismiss={noop}
      />,
    );
    expect(html).not.toContain("Read here");
    expect(html).not.toContain("Speak");
  });

  it("grows by one row and one hairline per action", () => {
    expect(popupHeight(3)).toBe(3 * 28 + 2 + 2);
    expect(popupHeight(6) - popupHeight(3)).toBe(3 * 28 + 3);
  });
});
