import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level checks: the menus need a Radix context menu that is open, which
 * vitest cannot render. With no popup on selection, right-click is the only
 * way to these actions, so every text view's menu must keep offering them.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("selection actions on right-click", () => {
  it("lists Ask Terax, Add to Note and Open Mermaid", () => {
    const src = read("src/modules/ai/components/SelectionActionItems.tsx");
    for (const label of ["Ask Terax", "Add to Note", "Open Mermaid"])
      expect(src).toContain(`>${label}<`);
  });

  it("are offered by the terminal menu", () => {
    const src = read("src/modules/terminal/TerminalContextMenu.tsx");
    expect(src).toMatch(/<SelectionActionItems[\s\S]*?actions=\{selectionActions\}/);
  });

  it("are offered by the editor and both Markdown views", () => {
    const menu = read("src/modules/reader/components/ReadContextMenu.tsx");
    expect(menu).toMatch(
      /<SelectionActionItems[\s\S]*?actions=\{binding\.selectionActions\}/,
    );
    const app = read("src/app/App.tsx");
    const binding = app.slice(app.indexOf("const editorReadMenu"));
    expect(binding).toMatch(/selectionActions: selectionMenuActions/);
    expect(app).toMatch(/selectionActions=\{selectionMenuActions\}/);
  });
});
