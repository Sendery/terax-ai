import type { MermaidVisualLayout } from "@/modules/tabs";
import { lazy, Suspense } from "react";

const MermaidVisualEditor = lazy(() =>
  import("./MermaidVisualEditor").then((module) => ({
    default: module.MermaidVisualEditor,
  })),
);

type Props = {
  source: string;
  visualLayout?: MermaidVisualLayout;
  onSourceChange: (source: string) => void;
  onVisualLayoutChange: (layout: MermaidVisualLayout | undefined) => void;
  validateGeneratedSource: (source: string) => Promise<void>;
};

export function MermaidVisualEditorLazy(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading visual editor...
        </div>
      }
    >
      <MermaidVisualEditor {...props} />
    </Suspense>
  );
}
