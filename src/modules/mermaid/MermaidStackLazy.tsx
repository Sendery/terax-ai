import { type ComponentProps, lazy, Suspense } from "react";
import type { MermaidStack as MermaidStackType } from "./MermaidStack";

const MermaidStackInner = lazy(() =>
  import("./MermaidStack").then((module) => ({ default: module.MermaidStack })),
);

type Props = ComponentProps<typeof MermaidStackType>;

export function MermaidStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <MermaidStackInner {...props} />
    </Suspense>
  );
}
