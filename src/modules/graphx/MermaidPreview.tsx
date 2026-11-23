import { MermaidGraph, mermaidFallbackNote } from "@/modules/graphx/MermaidGraph";
import { validateMermaidSource } from "@/modules/mermaid/lib/source";
import { lazy, type ReactNode, Suspense } from "react";

const MermaidImage = lazy(() =>
  import("@/modules/markdown/MarkdownMermaid").then((m) => ({
    default: m.MarkdownMermaid,
  })),
);

export function MermaidPreview({
  source,
  fallback,
  title,
}: {
  source: string;
  fallback: ReactNode;
  title?: string;
}) {
  const validated = validateMermaidSource(source);
  if (!validated.ok) {
    return (
      <div className="p-3">
        <p className="text-xs text-muted-foreground">{validated.message}</p>
        {fallback}
      </div>
    );
  }
  return (
    <MermaidGraph
      source={validated.source}
      title={title}
      fallback={(reason) => (
        <div className="h-full overflow-auto px-3">
          <p className="pt-2 text-[11px] text-muted-foreground">
            {mermaidFallbackNote(reason)}
          </p>
          <Suspense fallback={<p role="status">Rendering diagram...</p>}>
            <MermaidImage code={validated.source} fallback={fallback} />
          </Suspense>
        </div>
      )}
    />
  );
}
