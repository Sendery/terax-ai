import type { GraphPanelProps } from "@/modules/graphx/GraphPanels";
import { lazy, Suspense } from "react";

const Panels = lazy(() =>
  import("@/modules/graphx/GraphPanels").then((m) => ({
    default: m.GraphPanels,
  })),
);
export function GraphPanels(props: GraphPanelProps) {
  if (!props.tabs.some((t) => t.kind === "graphx")) return null;
  return (
    <Suspense fallback={null}>
      <Panels {...props} />
    </Suspense>
  );
}
