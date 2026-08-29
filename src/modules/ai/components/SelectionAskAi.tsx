import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import type { PresenceState } from "@/lib/usePresence";
import { useEffect, useRef } from "react";

export type SelectionAskAiProps = {
  state: PresenceState;
  x: number;
  y: number;
  onAsk: () => void;
  onAddToNote: () => void;
  onOpenMermaid: () => void;
  onDismiss: () => void;
};

const W = 168;
const H = 93;
const GAP = 10;

function ActionRow({
  label,
  shortcutKey,
  onClick,
}: {
  label: string;
  shortcutKey?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-full items-center justify-between gap-2 px-2 text-xs hover:bg-accent"
    >
      <span>{label}</span>
      {shortcutKey ? (
        <KbdGroup>
          <Kbd className="h-4 min-w-4 px-1 text-[10px]">
            {fmtShortcut(MOD_KEY, shortcutKey)}
          </Kbd>
        </KbdGroup>
      ) : null}
    </button>
  );
}

export function SelectionAskAi({
  state,
  x,
  y,
  onAsk,
  onAddToNote,
  onOpenMermaid,
  onDismiss,
}: SelectionAskAiProps) {
  const pos = useRef({ top: 0, left: 0 });
  const open = state === "open";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (open) {
    pos.current = {
      top: Math.max(8, y - H - GAP),
      left: Math.max(8, Math.min(x - W / 2, window.innerWidth - W - 8)),
    };
  }

  return (
    <div
      data-selection-ask-ai
      data-state={state}
      style={{ top: pos.current.top, left: pos.current.left, width: W }}
      className="fixed z-50 duration-150 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-1"
    >
      <div className="flex flex-col overflow-hidden rounded-md border border-border/60 bg-card/95 shadow-lg backdrop-blur-md">
        <ActionRow label="Ask Terax" shortcutKey="J" onClick={onAsk} />
        <div className="h-px bg-border/60" />
        <ActionRow label="Add to Note" shortcutKey="L" onClick={onAddToNote} />
        <div className="h-px bg-border/60" />
        <ActionRow label="Open Mermaid" onClick={onOpenMermaid} />
      </div>
    </div>
  );
}
