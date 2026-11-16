import { GraphFrame } from "@/modules/graphx/GraphFrame";
import { parseGraphSource } from "@/modules/graphx/lib/document";
import type { GraphTab } from "@/modules/tabs";
import { useId, useMemo } from "react";
export function GraphSourcePreview({
  source,
  document,
}: {
  source: string;
  document?: Pick<GraphTab, "documentId" | "revision">;
}) {
  const id = useId();
  const result = useMemo(() => {
    try {
      return { spec: parseGraphSource(source) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Invalid GraphX source",
      };
    }
  }, [source]);
  if (!result.spec)
    return (
      <p role="alert" className="p-3 text-xs text-destructive">
        {result.error}
      </p>
    );
  return (
    <GraphFrame
      key={source}
      tab={{
        documentId: document?.documentId ?? `preview-${id}`,
        revision: document?.revision ?? 1,
        title: result.spec.title,
        source,
      }}
    />
  );
}
