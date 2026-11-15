import { useTerminalProgress } from "@/modules/terminal/lib/terminalProgress";
import { ptyIdForLeaf } from "@/modules/terminal/lib/useTerminalSession";

export function TerminalProgress({ leafId }: { leafId: number }) {
  const progress = useTerminalProgress((state) => state.values[leafId]);
  if (!progress || progress.ptyId !== ptyIdForLeaf(leafId)) return null;
  const label =
    progress.state === 2
      ? "Terminal task error"
      : progress.state === 4
        ? "Terminal task paused"
        : "Terminal task progress";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.percent ?? undefined}
      data-terax-capture-foreground=""
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1 overflow-hidden bg-muted"
    >
      <div
        className={
          progress.state === 2 ? "h-full bg-destructive" : "h-full bg-primary"
        }
        style={{
          width: progress.percent === null ? "100%" : `${progress.percent}%`,
          opacity: progress.percent === null ? 0.55 : 1,
        }}
      />
    </div>
  );
}
