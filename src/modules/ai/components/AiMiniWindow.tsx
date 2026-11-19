import { cn } from "@/lib/utils";
import type { PresenceState } from "@/lib/usePresence";
import { useEffect } from "react";
import type { ResizeDir } from "../lib/miniWindowGeometry";
import { useMiniWindowGeometry } from "../lib/useMiniWindowGeometry";
import { useChatStore } from "../store/chatStore";
import { AiChatSurface } from "./AiChatSurface";
import { useChatRelocate } from "./ChatRelocate";
import { PlanDiffReview } from "./PlanDiffReview";

export function AiMiniWindow({ state }: { state: PresenceState }) {
  const closeMini = useChatStore((s) => s.closeMini);
  const { hint, floatingHooks } = useChatRelocate("floating");
  const { ref, onHeaderPointerDown, startResize } =
    useMiniWindowGeometry(floatingHooks);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        closeMini();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeMini]);

  return (
    <div
      ref={ref}
      data-state={state}
      data-ai-mini-window
      data-chat-layout="floating"
      className={cn(
        "no-scrollbar-deep fixed z-40 flex flex-col overflow-hidden",
        "rounded-2xl border border-border/60 bg-card text-[12px]",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_24px_48px_-12px_rgba(0,0,0,0.45),0_8px_16px_-8px_rgba(0,0,0,0.3)]",
        "ring-1 ring-black/5 dark:ring-white/5",
        "duration-200 ease-out",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-2",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-foreground/[0.03] to-transparent"
      />
      {RESIZE_DIRS.map((dir) => (
        <ResizeHandle key={dir} dir={dir} onPointerDown={startResize(dir)} />
      ))}
      <AiChatSurface
        onClose={closeMini}
        closeHint="Close (Esc)"
        onHeaderPointerDown={onHeaderPointerDown}
      />
      <PlanDiffReview />
      {hint}
    </div>
  );
}

const RESIZE_HANDLE_CLASS: Record<ResizeDir, string> = {
  n: "top-0 left-3 right-3 h-1.5 cursor-ns-resize",
  s: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize",
  w: "top-3 bottom-3 left-0 w-1.5 cursor-ew-resize",
  e: "top-3 bottom-3 right-0 w-1.5 cursor-ew-resize",
  nw: "top-0 left-0 size-3 cursor-nwse-resize",
  ne: "top-0 right-0 size-3 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-3 cursor-nesw-resize",
  se: "bottom-0 right-0 size-3 cursor-nwse-resize",
};

const RESIZE_DIRS: ResizeDir[] = ["n", "s", "w", "e", "nw", "ne", "sw", "se"];

function ResizeHandle({
  dir,
  onPointerDown,
}: {
  dir: ResizeDir;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      data-no-drag
      onPointerDown={onPointerDown}
      className={cn("absolute z-50 touch-none select-none", RESIZE_HANDLE_CLASS[dir])}
    />
  );
}
