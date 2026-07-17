import {
  Add01Icon,
  ArrowExpandDiagonal01Icon,
  Cancel01Icon,
  Note01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { NoteCard } from "./lib/cards";
import type { NoteCardPatch } from "./lib/collection";
import { NoteCardView } from "./NoteCardView";

// A drag that starts on one of these should act normally, not reorder.
const INTERACTIVE = "button, a, input, textarea, select, [contenteditable=true]";

export function NotesPanel({
  notes,
  disabled = false,
  subtitle = null,
  hideTitle = "Hide notes",
  onAddFromInput,
  onRemove,
  onUpdate,
  onMove,
  onCite,
  onHide,
  onDetach,
  onRefresh,
  onRefreshAll,
}: {
  notes: readonly NoteCard[];
  disabled?: boolean;
  /** Optional context label (e.g. the owning tab title). */
  subtitle?: string | null;
  /** Tooltip/aria for the header dismiss button. */
  hideTitle?: string;
  onAddFromInput: (raw: string) => void;
  onRemove: (id: string) => void;
  /** When provided, cards expose an edit affordance that persists a patch. */
  onUpdate?: (id: string, patch: NoteCardPatch) => void;
  /** When provided, cards can be drag-reordered by grabbing the card. */
  onMove?: (id: string, toIndex: number) => void;
  /** When provided, cards expose a button to cite their reference in the shell. */
  onCite?: (card: NoteCard) => void;
  onHide: () => void;
  /** When provided, shows a button to pop the panel into a floating window. */
  onDetach?: () => void;
  /** Live status refresh for a single card (GitHub PR / Jira). */
  onRefresh?: (id: string) => void | Promise<void>;
  /** Refresh every live card. */
  onRefreshAll?: () => void | Promise<void>;
}) {
  const hasLive = notes.some(
    (c) => c.kind === "github-pr" || c.kind === "jira",
  );
  const [draft, setDraft] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Pointer-based reorder. WKWebView (Tauri/macOS) does not deliver reliable
  // HTML5 drag-and-drop for DOM reordering, so we drive it with pointer events
  // + pointer capture and resolve the drop target by coordinates.
  const dragStateRef = useRef<{
    id: string;
    startIndex: number;
    started: boolean;
    startY: number;
  } | null>(null);

  const endDrag = useCallback(() => {
    dragStateRef.current = null;
    setDragId(null);
    setOverId(null);
  }, []);

  // Index of the card whose vertical midpoint the pointer sits above.
  const indexAtY = useCallback((clientY: number): number => {
    const ul = listRef.current;
    if (!ul) return -1;
    const items = Array.from(
      ul.querySelectorAll<HTMLElement>("li[data-note-id]"),
    );
    for (let i = 0; i < items.length; i += 1) {
      const r = items[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return items.length - 1;
  }, []);

  const submit = useCallback(() => {
    const value = draft.trim();
    if (!value) return;
    onAddFromInput(value);
    setDraft("");
  }, [draft, onAddFromInput]);

  return (
    <aside
      aria-label="Notes"
      className="flex h-full min-h-0 flex-col border-l border-border/60 bg-card"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <HugeiconsIcon
          icon={Note01Icon}
          size={15}
          strokeWidth={1.9}
          className="text-muted-foreground"
        />
        <h2 className="flex min-w-0 flex-1 items-baseline gap-1.5 text-xs font-semibold tracking-wide text-foreground">
          <span>Notes</span>
          {notes.length > 0 && (
            <span className="text-muted-foreground">{notes.length}</span>
          )}
          {subtitle && (
            <span className="truncate text-[11px] font-normal text-muted-foreground/80">
              · {subtitle}
            </span>
          )}
        </h2>
        {onRefreshAll && hasLive && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh all live statuses"
            title="Refresh statuses"
            onClick={() => void onRefreshAll()}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={2} />
          </Button>
        )}
        {onDetach && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open notes in a floating window"
            title="Detach to floating window"
            onClick={onDetach}
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon
              icon={ArrowExpandDiagonal01Icon}
              size={13}
              strokeWidth={2}
            />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={hideTitle}
          title={hideTitle}
          onClick={onHide}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
        </Button>
      </header>

      <form
        className="flex shrink-0 items-center gap-1.5 border-b border-border/60 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          placeholder={
            disabled ? "Open a tab to add notes" : "Paste a link or type a note…"
          }
          aria-label="New note: paste a link or type text"
          className="h-8 text-sm"
        />
        <Button
          type="submit"
          size="icon"
          variant="secondary"
          aria-label="Add note"
          title="Add note"
          disabled={disabled || draft.trim() === ""}
          className="size-8 shrink-0"
        >
          <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={2} />
        </Button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {notes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <HugeiconsIcon
              icon={Note01Icon}
              size={26}
              strokeWidth={1.5}
              className="text-muted-foreground/40"
            />
            <p className="text-xs text-muted-foreground">
              No notes for this tab yet.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Paste a Jira, GitHub PR, Notion, Figma or Obsidian link — or jot a
              quick note.
            </p>
          </div>
        ) : (
          <ul ref={listRef} className="flex flex-col gap-2">
            {notes.map((card, index) => (
              <li
                key={card.id}
                data-note-id={card.id}
                aria-roledescription={onMove ? "Draggable note" : undefined}
                className={cn(
                  "rounded-lg",
                  onMove && "cursor-grab touch-none select-none active:cursor-grabbing",
                  onMove &&
                    overId === card.id &&
                    dragId !== card.id &&
                    "ring-2 ring-primary/40",
                  dragId === card.id && "opacity-50",
                )}
                onPointerDown={
                  onMove
                    ? (e) => {
                        // Only a primary-button drag on the card body (never on
                        // a control) starts a reorder.
                        if (e.button !== 0) return;
                        if ((e.target as HTMLElement).closest(INTERACTIVE)) {
                          return;
                        }
                        e.currentTarget.setPointerCapture(e.pointerId);
                        dragStateRef.current = {
                          id: card.id,
                          startIndex: index,
                          started: false,
                          startY: e.clientY,
                        };
                      }
                    : undefined
                }
                onPointerMove={
                  onMove
                    ? (e) => {
                        const st = dragStateRef.current;
                        if (!st) return;
                        if (!st.started) {
                          if (Math.abs(e.clientY - st.startY) < 4) return;
                          st.started = true;
                          setDragId(st.id);
                        }
                        const idx = indexAtY(e.clientY);
                        setOverId(idx >= 0 ? (notes[idx]?.id ?? null) : null);
                      }
                    : undefined
                }
                onPointerUp={
                  onMove
                    ? (e) => {
                        const st = dragStateRef.current;
                        dragStateRef.current = null;
                        if (st?.started) {
                          const idx = indexAtY(e.clientY);
                          if (idx >= 0 && idx !== st.startIndex) {
                            onMove(st.id, idx);
                          }
                        }
                        endDrag();
                      }
                    : undefined
                }
                onPointerCancel={onMove ? endDrag : undefined}
              >
                <NoteCardView
                  card={card}
                  onRemove={onRemove}
                  onUpdate={onUpdate}
                  onCite={onCite}
                  onRefresh={onRefresh}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
