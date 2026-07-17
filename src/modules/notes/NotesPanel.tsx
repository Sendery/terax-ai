import { Add01Icon, Cancel01Icon, Note01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NoteCard } from "./lib/cards";
import { NoteCardView } from "./NoteCardView";

export function NotesPanel({
  notes,
  disabled = false,
  onAddFromInput,
  onRemove,
  onHide,
}: {
  notes: readonly NoteCard[];
  disabled?: boolean;
  onAddFromInput: (raw: string) => void;
  onRemove: (id: string) => void;
  onHide: () => void;
}) {
  const [draft, setDraft] = useState("");

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
        <h2 className="flex-1 text-xs font-semibold tracking-wide text-foreground">
          Notes
          {notes.length > 0 && (
            <span className="ml-1.5 text-muted-foreground">{notes.length}</span>
          )}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide notes panel"
          title="Hide notes"
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
          <ul className="flex flex-col gap-2">
            {notes.map((card) => (
              <li key={card.id}>
                <NoteCardView card={card} onRemove={onRemove} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
