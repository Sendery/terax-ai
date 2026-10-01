import { ArrowRight01Icon, GitBranchIcon, GitForkIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";

import type { BranchFork } from "./lib/branches";
import type { SessionCandidate } from "./lib/pickSession";
import { TONE_COLOR } from "./lib/nodeGlyph";

/**
 * Everything you can move to from here: the alternatives a rewind left inside
 * this transcript, and the sessions this one was forked from or into.
 *
 * A rewind and a fork are the same idea at two scales, so they share one menu.
 */
export function SessionBranchSwitcher({
  forks,
  onSwitchBranch,
  parentSession,
  childSessions,
  onOpenSession,
}: {
  forks: readonly BranchFork[];
  onSwitchBranch: (tipId: string) => void;
  parentSession: SessionCandidate | null;
  childSessions: readonly SessionCandidate[];
  onOpenSession: (sessionId: string) => void;
}) {
  const hasNothing =
    forks.length === 0 && !parentSession && childSessions.length === 0;

  return (
    <div className="flex max-h-[60vh] w-80 flex-col overflow-y-auto py-1">
      {hasNothing && (
        <p className="px-2.5 py-3 text-center text-[11px] text-muted-foreground">
          This session never branched.
        </p>
      )}

      {forks.length > 0 && (
        <div className="px-2.5 pb-1 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Rewind points
        </div>
      )}
      {forks.map((fork, index) => (
        <div key={fork.branchPointId} className="pb-1">
          <div className="px-2.5 py-0.5 text-[10px] text-muted-foreground/60">
            fork {index + 1}
          </div>
          {fork.choices.map((choice, choiceIndex) => (
            <button
              key={choice.childId}
              type="button"
              onClick={() => onSwitchBranch(choice.tipId)}
              aria-current={choice.isActive ? "true" : undefined}
              className={cn(
                "flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left outline-none",
                "focus-visible:bg-foreground/[0.07]",
                choice.isActive
                  ? "bg-foreground/[0.07] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
              )}
            >
              <HugeiconsIcon
                icon={GitBranchIcon}
                size={11}
                strokeWidth={2}
                className="shrink-0"
                color={choice.isActive ? TONE_COLOR.user : undefined}
              />
              <span className="truncate text-[11px]">
                {choice.preview || `branch ${choiceIndex + 1}`}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground/60">
                {choice.size}
              </span>
              {choice.isActive && (
                <span className="shrink-0 text-[9px] text-muted-foreground/70">current</span>
              )}
            </button>
          ))}
        </div>
      ))}

      {(parentSession || childSessions.length > 0) && (
        <div className="border-t border-border/50 px-2.5 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Forked sessions
        </div>
      )}

      {parentSession && (
        <button
          type="button"
          onClick={() => onOpenSession(parentSession.id)}
          className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left text-muted-foreground outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:bg-foreground/[0.07]"
        >
          <HugeiconsIcon icon={GitForkIcon} size={11} strokeWidth={2} className="shrink-0" />
          <span className="truncate text-[11px]">forked from {parentSession.id.slice(0, 8)}</span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={11}
            strokeWidth={2}
            className="ml-auto shrink-0"
          />
        </button>
      )}

      {childSessions.map((child) => (
        <button
          key={child.id}
          type="button"
          onClick={() => onOpenSession(child.id)}
          className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left text-muted-foreground outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:bg-foreground/[0.07]"
        >
          <HugeiconsIcon icon={GitForkIcon} size={11} strokeWidth={2} className="shrink-0" />
          <span className="truncate text-[11px]">branched into {child.id.slice(0, 8)}</span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={11}
            strokeWidth={2}
            className="ml-auto shrink-0"
          />
        </button>
      ))}
    </div>
  );
}
