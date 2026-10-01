import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import type { SessionMilestone } from "./lib/graph";
import type { SessionMark } from "./lib/marks";
import { MARK_DOT_CLASS } from "./lib/markStyles";

/**
 * Document-style index over the transcript: user turns and recorded key points,
 * filterable, with the current position highlighted.
 *
 * This is the counterpart to the graph itself — the graph shows shape, the
 * outline shows structure and is how you get somewhere in a long session.
 */
export function SessionOutline({
  milestones,
  marks,
  currentRowIndex,
  rowIndexByNodeId,
  onJump,
}: {
  milestones: readonly SessionMilestone[];
  marks: ReadonlyMap<string, SessionMark>;
  currentRowIndex: number;
  rowIndexByNodeId: ReadonlyMap<string, number>;
  onJump: (rowIndex: number) => void;
}) {
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const turns = milestones.map((milestone, index) => ({
      key: `turn-${milestone.nodeId}`,
      nodeId: milestone.nodeId,
      rowIndex: milestone.rowIndex,
      ordinal: index + 1,
      label: milestone.preview || "(no text)",
      mark: marks.get(milestone.nodeId) ?? null,
      isMarkOnly: false,
    }));

    // Marks placed on agent steps are not turns, but they are exactly what the
    // user asked to keep findable, so the index lists them too.
    const extras = [...marks.values()]
      .filter((mark) => !milestones.some((m) => m.nodeId === mark.nodeId))
      .map((mark) => ({
        key: `mark-${mark.nodeId}`,
        nodeId: mark.nodeId,
        rowIndex: rowIndexByNodeId.get(mark.nodeId) ?? -1,
        ordinal: 0,
        label: mark.label,
        mark,
        isMarkOnly: true,
      }))
      .filter((item) => item.rowIndex >= 0);

    const all = [...turns, ...extras].sort((a, b) => a.rowIndex - b.rowIndex);
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        (item.mark?.label ?? "").toLowerCase().includes(needle),
    );
  }, [milestones, marks, query, rowIndexByNodeId]);

  // The active item is the last one at or above the viewport.
  const activeKey = useMemo(() => {
    let key: string | null = null;
    for (const item of items) {
      if (item.rowIndex <= currentRowIndex) key = item.key;
      else break;
    }
    return key;
  }, [items, currentRowIndex]);

  return (
    <div className="flex max-h-[60vh] w-80 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
        <HugeiconsIcon
          icon={Search01Icon}
          size={12}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter turns and marks"
          aria-label="Filter session outline"
          className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {items.length > 0 && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            {items.length}
          </span>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {items.length === 0 ? (
          <li className="px-2.5 py-3 text-center text-[11px] text-muted-foreground">
            Nothing matches.
          </li>
        ) : (
          items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onJump(item.rowIndex)}
                aria-current={item.key === activeKey ? "true" : undefined}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left outline-none",
                  "focus-visible:bg-foreground/[0.07]",
                  item.key === activeKey
                    ? "bg-foreground/[0.07] text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                )}
              >
                {item.isMarkOnly && item.mark ? (
                  <span
                    aria-hidden
                    className={cn("size-1.5 shrink-0 rounded-full", MARK_DOT_CLASS[item.mark.color])}
                  />
                ) : (
                  <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/60">
                    {item.ordinal}
                  </span>
                )}
                <span className="truncate text-[11px]">{item.label}</span>
                {item.mark && !item.isMarkOnly && (
                  <span
                    aria-hidden
                    className={cn("ml-auto size-1.5 shrink-0 rounded-full", MARK_DOT_CLASS[item.mark.color])}
                  />
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
