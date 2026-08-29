import { Button } from "@/components/ui/button";
import type { MermaidVisualLayout } from "@/modules/tabs";
import { type PropsWithChildren, useEffect, useRef, useState } from "react";
import {
  classifyMermaidVisualSource,
  type MermaidVisualDocument,
  serializeMermaidVisualDocument,
} from "./lib/visualDocument";
import {
  commitVisualHistory,
  createVisualHistory,
  resetVisualHistory,
  takeVisualHistoryStep,
  type VisualHistory,
} from "./lib/visualHistory";
import { prepareMermaidVisualTransaction } from "./lib/visualTransaction";
import { FlowchartVisualEditor } from "./visual/FlowchartVisualEditor";
import { SequenceVisualEditor } from "./visual/SequenceVisualEditor";

type Props = {
  source: string;
  visualLayout?: MermaidVisualLayout;
  onSourceChange: (source: string) => void;
  onVisualLayoutChange: (layout: MermaidVisualLayout | undefined) => void;
  validateGeneratedSource: (source: string) => Promise<void>;
};

type ExpectedState = {
  source: string;
  visualLayout?: MermaidVisualLayout;
};

export function VisualMutationBoundary({
  disabled,
  children,
}: PropsWithChildren<{ disabled: boolean }>) {
  return (
    <fieldset
      disabled={disabled}
      aria-busy={disabled}
      className="m-0 min-h-0 min-w-0 flex-1 border-0 p-0"
    >
      {children}
    </fieldset>
  );
}

function layoutsEqual(
  left: MermaidVisualLayout | undefined,
  right: MermaidVisualLayout | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function historyFrom(
  source: string,
  visualLayout?: MermaidVisualLayout,
): {
  history: VisualHistory<MermaidVisualDocument> | null;
  reason: string | null;
} {
  const classification = classifyMermaidVisualSource(source, visualLayout);
  return classification.status === "editable"
    ? {
        history: createVisualHistory(classification.document),
        reason: null,
      }
    : { history: null, reason: classification.reason };
}

function layoutFor(
  document: MermaidVisualDocument,
): MermaidVisualLayout | undefined {
  return document.kind === "flowchart" ? document.layout : undefined;
}

export function MermaidVisualEditor({
  source,
  visualLayout,
  onSourceChange,
  onVisualLayoutChange,
  validateGeneratedSource,
}: Props) {
  const initial = historyFrom(source, visualLayout);
  const [history, setHistory] = useState(initial.history);
  const [lockedReason, setLockedReason] = useState(initial.reason);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const validatingRef = useRef(false);
  const expectedRef = useRef<ExpectedState>({ source, visualLayout });
  const transactionRef = useRef(0);

  useEffect(() => {
    const expected = expectedRef.current;
    if (
      source === expected.source &&
      layoutsEqual(visualLayout, expected.visualLayout)
    ) {
      return;
    }
    expectedRef.current = { source, visualLayout };
    transactionRef.current += 1;
    validatingRef.current = false;
    setValidating(false);
    const next = historyFrom(source, visualLayout);
    setHistory(next.history ? resetVisualHistory(next.history.present) : null);
    setLockedReason(next.reason);
    setError(null);
  }, [source, visualLayout]);

  const publish = async (
    nextHistory: VisualHistory<MermaidVisualDocument>,
  ): Promise<boolean> => {
    if (validatingRef.current) return false;
    const transaction = transactionRef.current + 1;
    transactionRef.current = transaction;
    validatingRef.current = true;
    setValidating(true);
    try {
      const prepared = await prepareMermaidVisualTransaction(
        nextHistory.present,
        validateGeneratedSource,
      );
      if (transaction !== transactionRef.current) return false;
      expectedRef.current = {
        source: prepared.source,
        visualLayout: prepared.visualLayout,
      };
      setHistory(nextHistory);
      setLockedReason(null);
      setError(null);
      if (prepared.source !== source) onSourceChange(prepared.source);
      if (!layoutsEqual(prepared.visualLayout, visualLayout)) {
        onVisualLayoutChange(prepared.visualLayout);
      }
      return true;
    } catch (cause) {
      if (transaction === transactionRef.current) {
        setError(
          cause instanceof Error ? cause.message : "Unable to validate diagram",
        );
      }
      return false;
    } finally {
      if (transaction === transactionRef.current) {
        validatingRef.current = false;
        setValidating(false);
      }
    }
  };

  const commit = (document: MermaidVisualDocument) => {
    if (!history || validatingRef.current) return;
    try {
      const nextSource = serializeMermaidVisualDocument(document);
      const currentSource = serializeMermaidVisualDocument(history.present);
      if (
        nextSource === currentSource &&
        layoutsEqual(layoutFor(document), layoutFor(history.present))
      ) {
        return;
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to serialize diagram",
      );
      return;
    }
    void publish(commitVisualHistory(history, document));
  };

  const undo = () => {
    if (!history || validatingRef.current) return;
    const next = takeVisualHistoryStep(history, "undo");
    if (next) void publish(next);
  };

  const redo = () => {
    if (!history || validatingRef.current) return;
    const next = takeVisualHistoryStep(history, "redo");
    if (next) void publish(next);
  };

  if (!history) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-xl border border-border/70 bg-muted/20 p-5 text-center">
          <h3 className="text-sm font-semibold text-foreground">
            Visual editing is unavailable for this source
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {lockedReason}. Continue in Source mode to preserve every construct
            exactly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label="Mermaid visual editor"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, select")) return;
        if (
          !(event.metaKey || event.ctrlKey) ||
          event.key.toLowerCase() !== "z"
        ) {
          return;
        }
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-2.5">
        <span className="text-[11px] text-muted-foreground">
          {history.present.kind === "flowchart"
            ? "Flowchart visual editor"
            : "Sequence visual editor"}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={validating || history.past.length === 0}
            onClick={undo}
          >
            Undo
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={validating || history.future.length === 0}
            onClick={redo}
          >
            Redo
          </Button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
        >
          {error}
        </div>
      )}
      {validating && (
        <div
          role="status"
          className="border-b border-border/60 px-3 py-1 text-[10px] text-muted-foreground"
        >
          Validating generated Mermaid source...
        </div>
      )}
      <VisualMutationBoundary disabled={validating}>
        {history.present.kind === "flowchart" ? (
          <FlowchartVisualEditor document={history.present} onCommit={commit} />
        ) : (
          <SequenceVisualEditor document={history.present} onCommit={commit} />
        )}
      </VisualMutationBoundary>
    </section>
  );
}
