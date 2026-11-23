import { GraphFrame } from "@/modules/graphx/GraphFrame";
import {
  graphxDrawsMermaid,
  mermaidDiagramType,
} from "@/modules/graphx/lib/mermaid";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

export type MermaidFallbackReason =
  | { kind: "unsupported"; type: string | null }
  | { kind: "conversion"; message: string };

type Props = {
  /** Validated, fence-normalized Mermaid source. */
  source: string;
  title?: string;
  /** Stable owner identity (a Mermaid tab); a local preview identity otherwise. */
  documentId?: string;
  /**
   * The Mermaid renderer, used for the diagram types GraphX refuses (data charts,
   * ZenUML, unknown types) and for a source its converter cannot read.
   */
  fallback: (reason: MermaidFallbackReason) => ReactNode;
  /** Told once per source when the fallback takes over, for owners that render it. */
  onFallback?: (source: string, reason: MermaidFallbackReason) => void;
};

/** FNV-1a over the source: a frame revision that changes whenever the source does. */
function sourceRevision(source: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash + 1;
}

export function mermaidFallbackNote(reason: MermaidFallbackReason): string {
  return reason.kind === "unsupported"
    ? `Drawn with Mermaid: GraphX does not draw ${reason.type ? `"${reason.type}"` : "this kind of"} diagrams.`
    : `Drawn with Mermaid: GraphX could not convert this source (${reason.message}).`;
}

/**
 * Mermaid source drawn by GraphX, the default diagram viewer. The source stays Mermaid:
 * it is converted inside the sandboxed GraphX frame on every render and never stored as
 * GraphX JSON.
 */
export function MermaidGraph({
  source,
  title,
  documentId,
  fallback,
  onFallback,
}: Props) {
  const localId = useId();
  const [failed, setFailed] = useState<{
    source: string;
    message: string;
  } | null>(null);
  const [skipped, setSkipped] = useState<{
    source: string;
    warnings: string[];
  } | null>(null);
  const onMermaidError = useCallback(
    (message: string) => setFailed({ source, message }),
    [source],
  );
  const onMermaidWarnings = useCallback(
    (warnings: string[]) => setSkipped({ source, warnings }),
    [source],
  );
  const drawable = graphxDrawsMermaid(source);
  const failure = failed?.source === source ? failed.message : null;
  const reason = useMemo<MermaidFallbackReason | null>(
    () =>
      !drawable
        ? { kind: "unsupported", type: mermaidDiagramType(source) }
        : failure !== null
          ? { kind: "conversion", message: failure }
          : null,
    [drawable, failure, source],
  );
  useEffect(() => {
    if (reason) onFallback?.(source, reason);
  }, [reason, source, onFallback]);
  if (reason) return fallback(reason);
  const warnings = skipped?.source === source ? skipped.warnings : [];
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <GraphFrame
        mermaid
        tab={{
          documentId: documentId ?? `mermaid-${localId}`,
          revision: sourceRevision(source),
          source,
          title: title ?? "Mermaid diagram",
        }}
        onMermaidError={onMermaidError}
        onMermaidWarnings={onMermaidWarnings}
      />
      {warnings.length > 0 ? (
        <p
          className="shrink-0 truncate border-t border-border/50 px-3 py-1 text-[11px] text-muted-foreground"
          title={warnings.join("\n")}
        >
          GraphX skipped {warnings.length} Mermaid{" "}
          {warnings.length === 1 ? "statement" : "statements"} it does not
          draw: {warnings[0]}
        </p>
      ) : null}
    </div>
  );
}
