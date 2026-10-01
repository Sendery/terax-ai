import { cn } from "@/lib/utils";
import {
  aggregateAgentPhases,
  leafIds,
  ptyIdForLeaf,
  useAgentActivityStore,
} from "@/modules/terminal";
import { tabStateMark } from "./lib/agentMark";
import type { Tab } from "./lib/useTabs";

// Fixed status hues (light/dark aware) matching the app's other status dots
// (diagnostics amber, tool-approval amber); attention reuses the approval amber.
const DOT_CLASS: Record<"working" | "attention", string> = {
  working: "bg-sky-500 dark:bg-sky-400",
  attention: "bg-amber-500 dark:bg-amber-400",
};

export function AgentTabBadge({ tab }: { tab: Tab }) {
  const phases = useAgentActivityStore((s) => s.phases);
  const reasons = useAgentActivityStore((s) => s.reasons);
  if (tab.kind !== "terminal") return null;

  const ptyIds: number[] = [];
  for (const leaf of leafIds(tab.paneTree)) {
    const id = ptyIdForLeaf(leaf);
    if (id !== null) ptyIds.push(id);
  }

  const status = aggregateAgentPhases(phases, ptyIds, reasons);
  const { top, count } = status;
  if (!top) return null;

  const mark = tabStateMark(status);
  const label = `${count} agent${count === 1 ? "" : "s"} · ${status.reason ?? top}`;

  return (
    <span
      data-no-drag
      role="img"
      className="flex shrink-0 items-center gap-0.5"
      aria-label={label}
      title={label}
    >
      {top === "finished" ? null : (
        <span className="relative flex size-2">
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-70 motion-reduce:hidden",
              DOT_CLASS[top],
            )}
          />
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              DOT_CLASS[top],
            )}
          />
        </span>
      )}
      {mark ? (
        <span aria-hidden className="text-[10px] leading-none">
          {mark}
        </span>
      ) : null}
      {count > 1 ? (
        <span className="text-[9px] font-semibold tabular-nums text-foreground/70">
          {count}
        </span>
      ) : null}
    </span>
  );
}
