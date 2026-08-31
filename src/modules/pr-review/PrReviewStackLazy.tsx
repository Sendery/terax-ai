import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { PrReviewStack as PrReviewStackType } from "./PrReviewStack";

// The review mounts CodeMirror's merge views; keeping it out of the startup
// graph is what lets a workspace that never opens one stay cheap.
const PrReviewStackInner = lazy(() =>
  import("./PrReviewStack").then((m) => ({ default: m.PrReviewStack })),
);

type Props = ComponentProps<typeof PrReviewStackType>;

export function PrReviewStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <PrReviewStackInner {...props} />
    </Suspense>
  );
}
