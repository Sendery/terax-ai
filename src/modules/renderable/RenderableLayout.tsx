import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { ViewMode } from "@/modules/renderable/viewMode";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGroupRef } from "react-resizable-panels";

export function RenderableLayout({
  mode,
  raw,
  rendered,
}: {
  mode: ViewMode;
  raw: ReactNode;
  rendered: ReactNode;
}) {
  const group = useGroupRef();
  const id = useId();
  const rawId = `${id}-raw`;
  const renderedId = `${id}-rendered`;
  const layout = useMemo(
    () => ({
      [rawId]: mode === "raw" ? 100 : mode === "rendered" ? 0 : 50,
      [renderedId]: mode === "raw" ? 0 : mode === "rendered" ? 100 : 50,
    }),
    [rawId, renderedId, mode],
  );
  const root = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < 620),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    group.current?.setLayout(layout);
  }, [group, layout]);
  return (
    <div ref={root} className="min-h-0 min-w-0 flex-1">
      <ResizablePanelGroup
        groupRef={group}
        orientation={narrow ? "vertical" : "horizontal"}
        disabled={mode !== "side-by-side"}
        defaultLayout={layout}
      >
        <ResizablePanel id={rawId} minSize={0}>
          <div
            className="h-full min-h-0 overflow-hidden"
            style={mode === "rendered" ? { display: "none" } : undefined}
            inert={mode === "rendered"}
          >
            {raw}
          </div>
        </ResizablePanel>
        <ResizableHandle
          withHandle
          disabled={mode !== "side-by-side"}
          className={mode === "side-by-side" ? undefined : "hidden"}
        />
        <ResizablePanel id={renderedId} minSize={0}>
          <div
            className="flex h-full min-h-0 flex-col overflow-hidden"
            style={mode === "raw" ? { display: "none" } : undefined}
          >
            {mode !== "raw" && rendered}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
