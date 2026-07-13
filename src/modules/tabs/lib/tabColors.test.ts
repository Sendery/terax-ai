import { describe, expect, it } from "vitest";
import {
  TAB_COLORS,
  TAB_COLOR_CSS,
  isTabColor,
  tabAccessibleLabel,
  tabColorForeground,
  tabColorStyle,
} from "./tabColors";
import { applyMarkdownView, applyTabPatch } from "./useTabs";
import type { EditorTab, MarkdownTab, Tab } from "./useTabs";

function termTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...overrides,
  } as Tab;
}

describe("tab color palette", () => {
  it("includes color and dirty state in the explicit accessible label", () => {
    expect(tabAccessibleLabel("app.ts", "teal", true)).toBe(
      "app.ts - Teal - Unsaved changes",
    );
    expect(tabAccessibleLabel("shell", "blue", false)).toBe("shell - Blue");
  });

  it("leaves uncolored tab naming to its existing descendants", () => {
    expect(tabAccessibleLabel("app.ts", undefined, true)).toBeUndefined();
  });

  it("exports exactly nine named colors", () => {
    expect(TAB_COLORS).toHaveLength(9);
    expect(TAB_COLORS).toContain("red");
    expect(TAB_COLORS).toContain("orange");
    expect(TAB_COLORS).toContain("amber");
    expect(TAB_COLORS).toContain("green");
    expect(TAB_COLORS).toContain("teal");
    expect(TAB_COLORS).toContain("blue");
    expect(TAB_COLORS).toContain("indigo");
    expect(TAB_COLORS).toContain("purple");
    expect(TAB_COLORS).toContain("pink");
  });

  it("provides a CSS color value for every palette entry", () => {
    for (const color of TAB_COLORS) {
      const css = TAB_COLOR_CSS[color];
      expect(typeof css).toBe("string");
      expect(css.length).toBeGreaterThan(0);
    }
  });
});

describe("tabColorForeground", () => {
  it("returns dark text over light fills for contrast", () => {
    // amber/green are light, so the foreground must be near-black.
    expect(tabColorForeground("amber")).toBe("#0a0a0a");
    expect(tabColorForeground("green")).toBe("#0a0a0a");
  });

  it("returns light text over dark fills for contrast", () => {
    expect(tabColorForeground("blue")).toBe("#ffffff");
    expect(tabColorForeground("indigo")).toBe("#ffffff");
    expect(tabColorForeground("purple")).toBe("#ffffff");
  });

  it("is defined for every palette color", () => {
    for (const color of TAB_COLORS) {
      expect(["#0a0a0a", "#ffffff"]).toContain(tabColorForeground(color));
    }
  });
});

describe("tabColorStyle", () => {
  it("paints a solid fill and contrasting text when active", () => {
    const style = tabColorStyle("green", true);
    expect(style.backgroundColor).toBe(TAB_COLOR_CSS.green);
    expect(style.borderColor).toBe(TAB_COLOR_CSS.green);
    expect(style.color).toBe("#0a0a0a");
  });

  it("paints a tinted fill and colored border when inactive", () => {
    const style = tabColorStyle("blue", false);
    expect(style.backgroundColor).toContain("rgba(");
    expect(style.borderColor).toContain("rgba(");
    // Inactive text is left to the muted-foreground class, not overridden.
    expect(style.color).toBeUndefined();
  });

  it("produces a style for every palette color in both states", () => {
    for (const color of TAB_COLORS) {
      for (const active of [true, false]) {
        const style = tabColorStyle(color, active);
        expect(style.backgroundColor.length).toBeGreaterThan(0);
        expect(style.borderColor.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("isTabColor", () => {
  it("accepts every palette color name", () => {
    for (const color of TAB_COLORS) {
      expect(isTabColor(color)).toBe(true);
    }
  });

  it("rejects arbitrary strings", () => {
    expect(isTabColor("")).toBe(false);
    expect(isTabColor("yellow")).toBe(false);
    expect(isTabColor("Red")).toBe(false);
    expect(isTabColor("RED")).toBe(false);
    expect(isTabColor("cyan")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isTabColor(null)).toBe(false);
    expect(isTabColor(undefined)).toBe(false);
    expect(isTabColor(42)).toBe(false);
    expect(isTabColor({})).toBe(false);
  });
});

describe("applyTabPatch color handling", () => {
  it("sets color on a tab that had none", () => {
    const tab = termTab();
    const patched = applyTabPatch(tab, { color: "blue" });
    expect(patched.color).toBe("blue");
  });

  it("replaces an existing color", () => {
    const tab = termTab({ color: "red" } as Partial<Tab>);
    const patched = applyTabPatch(tab, { color: "green" });
    expect(patched.color).toBe("green");
  });

  it("resets color to undefined when null is provided", () => {
    const tab = termTab({ color: "red" } as Partial<Tab>);
    const patched = applyTabPatch(tab, { color: null });
    expect(patched.color).toBeUndefined();
  });

  it("leaves color unchanged when the patch does not include a color key", () => {
    const tab = termTab({ color: "purple" } as Partial<Tab>);
    const patched = applyTabPatch(tab, { title: "new title" });
    expect(patched.color).toBe("purple");
  });

  it("leaves color undefined when the patch does not include a color key and no color was set", () => {
    const tab = termTab();
    const patched = applyTabPatch(tab, { title: "new title" });
    expect(patched.color).toBeUndefined();
  });
});

// ── Gap 2: markdown ↔ editor conversion must preserve TabBase metadata ──────

function markdownTab(overrides: Partial<MarkdownTab> = {}): MarkdownTab {
  return {
    id: 10,
    kind: "markdown",
    spaceId: "default",
    title: "readme",
    path: "README.md",
    ...overrides,
  };
}

function editorTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 10,
    kind: "editor",
    spaceId: "default",
    title: "readme",
    path: "README.md",
    dirty: false,
    preview: false,
    ...overrides,
  };
}

describe("applyMarkdownView", () => {
  it("converts markdown to raw editor preserving color and customTitle", () => {
    const tab = markdownTab({ color: "teal", customTitle: "My Readme" });
    const result = applyMarkdownView(tab, "raw");
    expect(result.kind).toBe("editor");
    expect(result.color).toBe("teal");
    expect(result.customTitle).toBe("My Readme");
  });

  it("converts raw editor back to markdown preserving color", () => {
    const tab = editorTab({ color: "purple" });
    const result = applyMarkdownView(tab, "rendered");
    expect(result.kind).toBe("markdown");
    expect(result.color).toBe("purple");
  });

  it("converts raw editor back to markdown preserving customTitle", () => {
    const tab = editorTab({ customTitle: "Custom Name" });
    const result = applyMarkdownView(tab, "rendered");
    expect(result.kind).toBe("markdown");
    expect(result.customTitle).toBe("Custom Name");
  });

  it("full round-trip: markdown → editor → markdown keeps color and customTitle", () => {
    const original = markdownTab({ color: "indigo", customTitle: "Dev Notes" });
    const asEditor = applyMarkdownView(original, "raw");
    const backToMarkdown = applyMarkdownView(asEditor as EditorTab, "rendered");
    expect(backToMarkdown.kind).toBe("markdown");
    expect(backToMarkdown.color).toBe("indigo");
    expect(backToMarkdown.customTitle).toBe("Dev Notes");
  });

  it("does not convert a dirty editor back to markdown", () => {
    const tab = editorTab({ dirty: true, color: "red" });
    const result = applyMarkdownView(tab, "rendered");
    expect(result.kind).toBe("editor");
  });

  it("is a no-op for a non-markdown path in editor mode", () => {
    const tab: EditorTab = { ...editorTab(), path: "main.ts" };
    const result = applyMarkdownView(tab, "rendered");
    expect(result).toBe(tab);
  });

  it("is a no-op for a non-markdown path in markdown mode", () => {
    const tab: MarkdownTab = { ...markdownTab(), path: "main.ts" };
    const result = applyMarkdownView(tab, "raw");
    expect(result).toBe(tab);
  });
});
