import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircleIcon,
  CancelCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
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
  Note01Icon,
  Notion01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CiState, GithubPrCard, JiraCard, NoteCard, PrState } from "./lib/cards";
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
}: {
  card: NoteCard;
  onRemove: (id: string) => void;
}) {
  const title = cardTitle(card);
  const isLink = card.kind !== "text";

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

      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${cardKindLabel(card)} card`}
        title="Delete"
        onClick={() => onRemove(card.id)}
        className="absolute right-1 top-1 size-6 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={2} />
      </Button>
    </article>
  );
}
