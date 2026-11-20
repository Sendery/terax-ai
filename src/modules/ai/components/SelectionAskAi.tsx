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
  /**
   * The reading actions, the same as the right-click menus. Absent where
   * reading aloud is off (a private terminal).
   */
  reading?: {
    onReadHere: () => void;
    onReadInNewTab: () => void;
    onSpeak: () => void;
  };
  onDismiss: () => void;
};

const W = 168;
const ROW = 28;
const GAP = 10;

/** Height of the popup: one row per action plus a hairline between them. */
export function popupHeight(rows: number): number {
  return rows * ROW + Math.max(0, rows - 1) + 2;
}

function ActionRow({
  label,
  shortcutKey,
  onClick,
  disabled,
}: {
  disabled: boolean;
  label: string;
  shortcutKey?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
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
  reading,
  onDismiss,
}: SelectionAskAiProps) {
  const H = popupHeight(reading ? 6 : 3);
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
        <ActionRow
          disabled={!open}
          label="Ask Terax"
          shortcutKey="J"
          onClick={onAsk}
        />
        <div className="h-px bg-border/60" />
        <ActionRow
          disabled={!open}
          label="Add to Note"
          shortcutKey="L"
          onClick={onAddToNote}
        />
        <div className="h-px bg-border/60" />
        <ActionRow
          disabled={!open}
          label="Open Mermaid"
          onClick={onOpenMermaid}
        />
        {reading ? (
          <>
            <div className="h-px bg-border/60" />
            <ActionRow
              disabled={!open}
              label="Read here"
              onClick={reading.onReadHere}
            />
            <div className="h-px bg-border/60" />
            <ActionRow
              disabled={!open}
              label="Read in new tab"
              onClick={reading.onReadInNewTab}
            />
            <div className="h-px bg-border/60" />
            <ActionRow
              disabled={!open}
              label="Speak"
              onClick={reading.onSpeak}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
