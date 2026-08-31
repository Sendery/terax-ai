import { describe, expect, it } from "vitest";
import { diffViewConfig, type DiffViewPrefs } from "./diffView";

const prefs = (over: Partial<DiffViewPrefs> = {}): DiffViewPrefs => ({
  layout: "unified",
  context: "changes",
  ...over,
});

describe("diffViewConfig", () => {
  it("collapses untouched regions when showing changes only", () => {
    const config = diffViewConfig(prefs({ context: "changes" }));

    expect(config.collapseUnchanged).toEqual({ margin: 3, minSize: 6 });
  });

  it("shows the whole file when asked for it", () => {
    // `undefined` is what CodeMirror reads as "collapse nothing"; a falsy
    // object would still collapse.
    expect(
      diffViewConfig(prefs({ context: "full" })).collapseUnchanged,
    ).toBeUndefined();
  });

  it("reports which pane arrangement to mount", () => {
    expect(diffViewConfig(prefs({ layout: "split" })).split).toBe(true);
    expect(diffViewConfig(prefs({ layout: "unified" })).split).toBe(false);
  });

  it("keeps both sides read-only in every arrangement", () => {
    // The review reads history; nothing here writes back to the repository.
    for (const layout of ["split", "unified"] as const) {
      expect(diffViewConfig(prefs({ layout })).readOnly).toBe(true);
    }
  });

  it("highlights changes and keeps deletions syntax-coloured", () => {
    const config = diffViewConfig(prefs());

    expect(config.highlightChanges).toBe(true);
    expect(config.syntaxHighlightDeletions).toBe(true);
  });
});
