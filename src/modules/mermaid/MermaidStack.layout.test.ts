import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./MermaidStack.tsx", import.meta.url),
  "utf8",
);

function paneRootClassName(): string {
  const marker = "data-mermaid-editor";
  const index = source.indexOf(marker);
  expect(index).toBeGreaterThan(-1);
  const before = source.slice(0, index);
  const openQuote = before.lastIndexOf('className="');
  const value = before.slice(openQuote + 'className="'.length);
  return value.slice(0, value.indexOf('"'));
}

describe("MermaidPane layout", () => {
  it("clips its own content so the mode toggle cannot scroll out of reach", () => {
    // The visual editor is much taller than the source editor. Without an
    // explicit clip the pane grows, an ancestor scrolls, and the
    // Source/Visual toggle plus the preview header leave the viewport.
    const className = paneRootClassName();

    expect(className).toContain("h-full");
    expect(className).toContain("min-h-0");
    expect(className).toContain("overflow-hidden");
  });
});
