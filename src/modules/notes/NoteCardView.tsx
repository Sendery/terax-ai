import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircleIcon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  CommandLineIcon,
  Delete02Icon,
  Diamond02Icon,
  FigmaIcon,
  FolderKanbanIcon,
  GitMergeIcon,
  GithubIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  Link01Icon,
  LinkSquare01Icon,
  Loading03Icon,
  Note01Icon,
  Notion01Icon,
  PencilEdit01Icon,
  RefreshIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CiState, GithubPrCard, JiraCard, NoteCard, PrState } from "./lib/cards";
import type { NoteCardPatch } from "./lib/collection";
import {
  buildEditPatch,
  type EditDraft,
  draftFromCard,
  editableFields,
} from "./lib/editing";
import {
  cardAccessibleLabel,
  cardKindLabel,
  cardTitle,
  ciStateLabel,
  jiraStatusLabel,
  prStateLabel,
} from "./lib/presentation";

const PROVIDER_ICON: Record<NoteCard["kind"], typeof Note01Icon> = {
  text: Note01Icon,
  link: Link01Icon,
  "github-pr": GithubIcon,
  jira: FolderKanbanIcon,
  notion: Notion01Icon,
  figma: FigmaIcon,
  obsidian: Diamond02Icon,
};

function prBadge(state: PrState): { icon: typeof Note01Icon; className: string } {
  switch (state) {
    case "open":
      return { icon: GitPullRequestIcon, className: "text-emerald-500" };
    case "draft":
      return { icon: GitPullRequestDraftIcon, className: "text-muted-foreground" };
    case "merged":
      return { icon: GitMergeIcon, className: "text-violet-500" };
    case "closed":
      return { icon: GitPullRequestClosedIcon, className: "text-red-500" };
    default:
      return { icon: GitPullRequestIcon, className: "text-muted-foreground" };
  }
}

function ciBadge(state: CiState): { icon: typeof Note01Icon; className: string } {
  switch (state) {
    case "success":
      return { icon: CheckmarkCircle01Icon, className: "text-emerald-500" };
    case "failure":
      return { icon: CancelCircleIcon, className: "text-red-500" };
    case "pending":
      return { icon: Clock01Icon, className: "text-amber-500" };
    case "error":
      return { icon: AlertCircleIcon, className: "text-red-500" };
    default:
      return { icon: Clock01Icon, className: "text-muted-foreground/60" };
  }
}

function StatusChip({
  icon,
  className,
  children,
}: {
  icon: typeof Note01Icon;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium",
        className,
      )}
    >
      <HugeiconsIcon icon={icon} size={11} strokeWidth={2} />
      {children}
    </span>
  );
}

function GithubPrMeta({ card }: { card: GithubPrCard }) {
  const pr = prBadge(card.prState);
  const ci = ciBadge(card.ciState);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <StatusChip icon={pr.icon} className={pr.className}>
        {prStateLabel(card.prState)}
      </StatusChip>
      <StatusChip icon={ci.icon} className={ci.className}>
        {ciStateLabel(card.ciState)}
      </StatusChip>
    </div>
  );
}

function JiraMeta({ card }: { card: JiraCard }) {
  const done = card.status === "done";
  const progress = card.status === "in-progress";
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <StatusChip
        icon={FolderKanbanIcon}
        className={cn(
          done && "text-emerald-500",
          progress && "text-sky-500",
          !done && !progress && "text-muted-foreground",
        )}
      >
        {card.statusName ?? jiraStatusLabel(card.status)}
      </StatusChip>
    </div>
  );
}

export function NoteCardView({
  card,
  onRemove,
  onUpdate,
  onCite,
  onRefresh,
}: {
  card: NoteCard;
  onRemove: (id: string) => void;
  /** Provided to enter edit mode and persist a patch. */
  onUpdate?: (id: string, patch: NoteCardPatch) => void;
  /** Provided to insert the card's reference into the active shell. */
  onCite?: (card: NoteCard) => void;
  /** Provided for live cards (GitHub PR, Jira) to fetch fresh status. */
  onRefresh?: (id: string) => void | Promise<void>;
}) {
  const title = cardTitle(card);
  const isLink = card.kind !== "text";
  const isLive = card.kind === "github-pr" || card.kind === "jira";
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(() => draftFromCard(card));
  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;
    setBusy(true);
    try {
      await onRefresh(card.id);
    } finally {
      setBusy(false);
    }
  }, [onRefresh, card.id]);

  const startEdit = useCallback(() => {
    setDraft(draftFromCard(card));
    setEditing(true);
  }, [card]);
  const cancelEdit = useCallback(() => setEditing(false), []);
  const saveEdit = useCallback(() => {
    const patch = buildEditPatch(card, draft);
    if (Object.keys(patch).length > 0) onUpdate?.(card.id, patch);
    setEditing(false);
  }, [card, draft, onUpdate]);

  if (editing) {
    const fields = editableFields(card);
    return (
      <article
        aria-label={`Editing ${cardKindLabel(card)} card`}
        className="rounded-lg border border-primary/50 bg-card/90 p-2.5 text-sm shadow-xs"
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              saveEdit();
            }
          }}
        >
          {fields.includes("title") && (
            <Input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Title (optional)"
              aria-label="Edit title"
              className="h-8 text-sm"
              autoFocus
            />
          )}
          {fields.includes("body") && (
            <Textarea
              value={draft.body}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              placeholder="Note text"
              aria-label="Edit note text"
              rows={4}
              className="resize-none text-sm"
            />
          )}
          {fields.includes("url") && (
            <Input
              value={draft.url}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              placeholder="https://…"
              aria-label="Edit link URL"
              type="url"
              inputMode="url"
              spellCheck={false}
              className="h-8 text-sm"
            />
          )}
          {fields.includes("note") && (
            <Textarea
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              placeholder="Annotation (optional)"
              aria-label="Edit annotation"
              rows={3}
              className="resize-none text-sm"
            />
          )}
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancelEdit}
              className="h-7 px-2 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="h-7 gap-1 px-2 text-xs"
            >
              <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2} />
              Save
            </Button>
          </div>
        </form>
      </article>
    );
  }

  return (
    <article
      aria-label={cardAccessibleLabel(card)}
      className="group relative rounded-lg border border-border/60 bg-card/80 p-2.5 pr-8 text-sm shadow-xs transition-colors hover:border-border"
    >
      <div className="flex items-start gap-2">
        <HugeiconsIcon
          icon={PROVIDER_ICON[card.kind]}
          size={16}
          strokeWidth={1.9}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {isLink && "url" in card ? (
              <button
                type="button"
                onClick={() => void openUrl(card.url).catch(console.error)}
                className="truncate text-left font-medium text-foreground hover:text-primary hover:underline"
                title={card.url}
              >
                {title}
              </button>
            ) : (
              <span className="truncate font-medium text-foreground">
                {title}
              </span>
            )}
            {isLink && (
              <HugeiconsIcon
                icon={LinkSquare01Icon}
                size={11}
                strokeWidth={2}
                className="shrink-0 text-muted-foreground/50"
              />
            )}
          </div>

          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {cardKindLabel(card)}
          </div>

          {card.kind === "text" && card.body.trim() && (
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
              {card.body}
            </p>
          )}
          {card.kind === "github-pr" && <GithubPrMeta card={card} />}
          {card.kind === "jira" && <JiraMeta card={card} />}
          {"note" in card && card.note && card.note.trim() && (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {card.note}
            </p>
          )}
        </div>
      </div>

      {/* Action stack: bottom-right, vertical. Refresh (top, live only) is
          spaced further from edit; edit sits above delete (bottom corner). */}
      {/* Cite lives on its own in the bottom-left corner, away from the
          edit/delete/refresh stack in the bottom-right. */}
      {onCite && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Cite ${cardKindLabel(card)} in the shell`}
          title="Cite in shell"
          onClick={() => onCite(card)}
          className="absolute bottom-1.5 left-1.5 size-6 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <HugeiconsIcon icon={CommandLineIcon} size={13} strokeWidth={2} />
        </Button>
      )}
      <div className="absolute bottom-1.5 right-1.5 flex flex-col items-center">
        {isLive && onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={busy ? "Refreshing status" : `Refresh ${cardKindLabel(card)} status`}
            title="Refresh status"
            disabled={busy}
            onClick={handleRefresh}
            className="mb-1 size-6 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 aria-busy:opacity-100"
            aria-busy={busy}
          >
            <HugeiconsIcon
              icon={busy ? Loading03Icon : RefreshIcon}
              size={13}
              strokeWidth={2}
              className={busy ? "animate-spin" : undefined}
            />
          </Button>
        )}
        {onUpdate && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${cardKindLabel(card)} card`}
            title="Edit"
            onClick={startEdit}
            className="mb-2.5 size-6 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <HugeiconsIcon icon={PencilEdit01Icon} size={13} strokeWidth={2} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${cardKindLabel(card)} card`}
          title="Delete"
          onClick={() => onRemove(card.id)}
          className="size-6 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={2} />
        </Button>
      </div>
    </article>
  );
}
