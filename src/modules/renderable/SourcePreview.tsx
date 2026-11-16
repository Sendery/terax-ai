import { lazy, Suspense, useEffect, useState } from "react";
import { fileRenderKind } from "@/modules/renderable/viewMode";
const Html = lazy(() =>
  import("@/modules/renderable/HtmlPreview").then((m) => ({
    default: m.HtmlPreview,
  })),
);
const Markdown = lazy(() =>
  import("@/modules/markdown/MarkdownPreviewPane").then((m) => ({
    default: m.MarkdownSourcePreview,
  })),
);
const Mermaid = lazy(() =>
  import("@/modules/markdown/MarkdownMermaid").then((m) => ({
    default: m.MarkdownMermaid,
  })),
);
const Graph = lazy(() =>
  import("@/modules/renderable/GraphSourcePreview").then((m) => ({
    default: m.GraphSourcePreview,
  })),
);
export function SourcePreview({
  source,
  path,
}: {
  source: string;
  path: string;
}) {
  const [settled, setSettled] = useState(source);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(source), 300);
    return () => clearTimeout(timer);
  }, [source]);
  const kind = fileRenderKind(path);
  return (
    <Suspense
      fallback={
        <p role="status" className="p-3 text-xs text-muted-foreground">
          Loading preview...
        </p>
      }
    >
      {kind === "html" ? (
        settled.length > 512 * 1024 ||
        new TextEncoder().encode(settled).length > 512 * 1024 ? (
          <p role="status">
            HTML preview is limited to 512 KiB. The raw file remains editable.
          </p>
        ) : (
          <Html source={settled} />
        )
      ) : kind === "markdown" ? (
        <Markdown source={settled} />
      ) : kind === "mermaid" ? (
        <div className="h-full overflow-auto p-3">
          <Mermaid
            code={settled}
            fallback={<pre className="whitespace-pre-wrap">{settled}</pre>}
          />
        </div>
      ) : kind === "graphx" ? (
        <Graph source={settled} />
      ) : null}
    </Suspense>
  );
}
