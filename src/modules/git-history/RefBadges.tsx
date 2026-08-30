import {
  CloudIcon,
  GitBranchIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";
import type { GitRef, GitRefKind } from "@/modules/ai/lib/native";

import { splitRefsForDisplay } from "./lib/refs";

const KIND_ICON = {
  branch: GitBranchIcon,
  remote: CloudIcon,
  tag: Tag01Icon,
  other: GitBranchIcon,
} satisfies Record<GitRefKind, unknown>;

const KIND_CLASS: Record<GitRefKind, string> = {
  branch: "border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300",
  remote:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  tag: "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300",
  other: "border-border/70 bg-foreground/5 text-muted-foreground",
};

const KIND_LABEL: Record<GitRefKind, string> = {
  branch: "branch",
  remote: "remote branch",
  tag: "tag",
  other: "ref",
};

export function refTitle(ref: GitRef): string {
  return ref.isHead
    ? `${KIND_LABEL[ref.kind]} ${ref.name}, checked out`
    : `${KIND_LABEL[ref.kind]} ${ref.name}`;
}

/**
 * The branches, tags and remote branches pointing at a commit.
 *
 * Kept to a handful per row: a decorated commit can carry a dozen refs and the
 * subject matters more, so the rest collapse into a counter that names them in
 * its tooltip.
 */
export function RefBadges({
  refs,
  limit = 3,
  className,
}: {
  refs: readonly GitRef[];
  limit?: number;
  className?: string;
}) {
  if (refs.length === 0) return null;
  const { shown, hidden, overflow } = splitRefsForDisplay(refs, limit);

  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 overflow-hidden",
        className,
      )}
    >
      {shown.map((ref) => (
        <span
          key={`${ref.kind}:${ref.name}`}
          title={refTitle(ref)}
          className={cn(
            "inline-flex h-[15px] min-w-0 max-w-[160px] items-center gap-0.5 rounded border px-1 text-[9.5px] font-medium leading-none",
            KIND_CLASS[ref.kind],
            ref.isHead && "ring-1 ring-current/35",
          )}
        >
          <HugeiconsIcon
            icon={KIND_ICON[ref.kind]}
            size={8.5}
            strokeWidth={2.2}
            className="shrink-0 opacity-80"
          />
          <span className="truncate">{ref.name}</span>
        </span>
      ))}
      {overflow > 0 ? (
        <span
          title={hidden.map(refTitle).join("\n")}
          className="inline-flex h-[15px] shrink-0 items-center rounded border border-border/70 bg-foreground/5 px-1 text-[9.5px] font-medium leading-none text-muted-foreground"
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
