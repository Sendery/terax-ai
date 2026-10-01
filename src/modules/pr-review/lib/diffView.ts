/** Side-by-side panes, or one document with the changes marked inline. */
export type DiffLayout = "split" | "unified";

/** Whether untouched regions of the file are collapsed away. */
export type DiffContext = "changes" | "full";

export type DiffViewPrefs = {
  layout: DiffLayout;
  context: DiffContext;
};

export type DiffViewConfig = {
  split: boolean;
  readOnly: boolean;
  highlightChanges: boolean;
  syntaxHighlightDeletions: boolean;
  /** Undefined shows the whole file; CodeMirror collapses only when given a shape. */
  collapseUnchanged: { margin: number; minSize: number } | undefined;
};

export const DEFAULT_DIFF_PREFS: DiffViewPrefs = {
  layout: "unified",
  context: "changes",
};

/** Turns the two user-facing toggles into what the merge view needs. */
export function diffViewConfig(prefs: DiffViewPrefs): DiffViewConfig {
  return {
    split: prefs.layout === "split",
    readOnly: true,
    highlightChanges: true,
    syntaxHighlightDeletions: true,
    collapseUnchanged:
      prefs.context === "changes" ? { margin: 3, minSize: 6 } : undefined,
  };
}
