import type { EditorView } from "@codemirror/view";
import { useEffect, useState } from "react";
import {
  formatGraphJson,
  graphJsonDiagnostics,
  jsonFormatTransaction,
} from "./lib/jsonEditing";

export function GraphJsonTools({
  source,
  getView,
}: {
  source: string;
  getView: () => EditorView | undefined;
}) {
  const [checked, setChecked] = useState(() => ({
    source,
    diagnostics: graphJsonDiagnostics(source),
  }));
  useEffect(() => {
    if (checked.source === source) return;
    const timer = setTimeout(
      () => setChecked({ source, diagnostics: graphJsonDiagnostics(source) }),
      300,
    );
    return () => clearTimeout(timer);
  }, [source, checked.source]);
  const pending = checked.source !== source;
  const diagnostics = pending ? [] : checked.diagnostics;
  const [formatError, setFormatError] = useState<{
    source: string;
    message: string;
  }>();
  const message =
    (formatError?.source === source ? formatError.message : undefined) ??
    diagnostics[0]?.message;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-2 py-1 text-xs">
      <button
        type="button"
        className="shrink-0 rounded px-2 py-1 hover:bg-accent"
        title="Format the draft with two-space indentation (one undo step)"
        onClick={() => {
          const view = getView();
          if (!view) return;
          const current = view.state.doc.toString();
          const result = formatGraphJson(current);
          setFormatError(
            result.error
              ? { source: current, message: result.error }
              : undefined,
          );
          const transaction = jsonFormatTransaction(view.state, result);
          if (transaction) view.dispatch(transaction);
          view.focus();
        }}
      >
        Format JSON
      </button>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`min-w-0 break-words ${message ? "text-destructive" : "text-muted-foreground"}`}
      >
        {message ?? (pending ? "Checking JSON..." : "JSON and GraphX valid")}
      </span>
    </div>
  );
}
