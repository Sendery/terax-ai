import { MermaidPreview } from "@/modules/graphx/MermaidPreview";
import { graphxDrawsMermaid } from "@/modules/graphx/lib/mermaid";
import { validateMermaidSource } from "@/modules/mermaid/lib/source";
import { type ReactNode, useEffect, useState } from "react";

type Props = {
  code: string;
  /** The plain code block, shown when the source cannot be drawn at all. */
  fallback: ReactNode;
};

/** Follows `value` after it has been stable for `ms`, so streamed fences settle first. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** True once the element has come near the viewport; it stays true afterwards. */
function useSeen(element: HTMLElement | null): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !element) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, seen]);
  return seen;
}

/**
 * A ```mermaid fence in rendered markdown. GraphX draws it by default, inside its
 * sandboxed frame, once the fence has settled and scrolled near the viewport, so a long
 * chat does not start one engine per diagram up front. Data charts and sources GraphX
 * cannot convert fall back to the hardened Mermaid renderer.
 */
export function MarkdownDiagram({ code, fallback }: Props) {
  const settled = useSettled(code, 300);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const seen = useSeen(box);
  const validation = validateMermaidSource(settled);
  if (!validation.ok) return fallback;
  return (
    <div
      ref={setBox}
      data-markdown-diagram={graphxDrawsMermaid(validation.source) ? "graphx" : "mermaid"}
      className="my-4 flex h-[420px] min-h-[180px] w-full resize-y flex-col overflow-auto rounded-md border border-border bg-background"
    >
      {seen ? (
        <MermaidPreview source={validation.source} fallback={fallback} />
      ) : (
        <div className="grid h-full place-items-center text-[12px] text-muted-foreground">
          Diagram
        </div>
      )}
    </div>
  );
}
