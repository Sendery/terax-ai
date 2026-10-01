import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import type { SessionGraphRow } from "./lib/graph";
import type { MarkColor } from "./lib/marks";
import { MARK_DOT_CLASS } from "./lib/markStyles";
import { nodeGlyph, TONE_COLOR } from "./lib/nodeGlyph";

/** Tighter than a comfortable list on purpose: more entries per screen. */
export const ROW_HEIGHT = 26;
const LANE_WIDTH = 15;
const RAIL_PADDING = 11;

/** Widest rail we draw; deeper nesting saturates rather than pushing text out. */
const MAX_DRAWN_LANES = 6;

export function railWidth(laneCount: number): number {
  const lanes = Math.max(1, Math.min(laneCount, MAX_DRAWN_LANES));
  return RAIL_PADDING * 2 + (lanes - 1) * LANE_WIDTH;
}

function laneX(lane: number): number {
  return RAIL_PADDING + Math.min(lane, MAX_DRAWN_LANES - 1) * LANE_WIDTH;
}

const NODE_RADIUS = { large: 8, medium: 7, small: 3.25 } as const;

/**
 * One row of the graph rail.
 *
 * Two channels of meaning, as in a git client: the lane colour and the curve
 * carry *structure* (which branch this is, where it forked), while the glyph
 * inside the node carries *process* (a shell command, an edit, a subagent).
 * Output nodes stay plain dots so the eye skips them.
 */
export function SessionGraphRailCell({
  row,
  laneCount,
  isFirst,
  isLast,
  selected,
}: {
  row: SessionGraphRow;
  laneCount: number;
  isFirst: boolean;
  isLast: boolean;
  selected: boolean;
}) {
  const width = railWidth(laneCount);
  const x = laneX(row.lane);
  const mid = ROW_HEIGHT / 2;
  const dim = !row.isOnActiveBranch;
  const glyph = nodeGlyph(row.node);
  const radius = NODE_RADIUS[glyph.size];
  const tone = TONE_COLOR[glyph.tone];

  // A branch row sits in its own lane but descends from the branch point's lane,
  // so its incoming edge is an elbow rather than a straight run.
  const parentLane = row.branchId === row.node.id ? row.lane - 1 : row.lane;
  const parentX = laneX(Math.max(0, parentLane));
  const isBranchStart = parentX !== x;

  const lineOpacity = dim ? 0.45 : 0.95;

  return (
    <span
      className="relative shrink-0"
      style={{ width, height: ROW_HEIGHT }}
      aria-hidden="true"
    >
      {/* Decorative: the row's own aria-label already describes the entry, its
          branch and its mark, so the rail must not add noise. */}
      <svg
        width={width}
        height={ROW_HEIGHT}
        viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
        role="presentation"
        aria-hidden="true"
      >
        {!isFirst &&
          (isBranchStart ? (
            <path
              d={`M ${parentX} 0 L ${parentX} ${mid - 7} Q ${parentX} ${mid} ${parentX + 7} ${mid} L ${x} ${mid}`}
              fill="none"
              stroke={row.color}
              strokeWidth={2}
              strokeOpacity={lineOpacity}
              strokeLinecap="round"
            />
          ) : (
            <line
              x1={x}
              y1={0}
              x2={x}
              y2={mid}
              stroke={row.color}
              strokeWidth={2}
              strokeOpacity={lineOpacity}
            />
          ))}

        {!isLast && (
          <line
            x1={x}
            y1={mid}
            x2={x}
            y2={ROW_HEIGHT}
            stroke={row.color}
            strokeWidth={2}
            strokeOpacity={lineOpacity}
          />
        )}

        {/* A fork leaves a stub heading right, so a rewind point is visible. */}
        {row.isBranchPoint && (
          <path
            d={`M ${x} ${mid} L ${x + 6} ${mid}`}
            stroke={row.color}
            strokeWidth={2}
            strokeOpacity={lineOpacity}
            strokeDasharray="2 2"
            strokeLinecap="round"
          />
        )}

        {selected && (
          <circle cx={x} cy={mid} r={radius + 3.5} fill={tone} fillOpacity={0.22} />
        )}

        {/* A solid disc in the process tone, ringed in the lane colour: the ring
            says which branch, the fill says what happened. The disc must stay
            solid — a translucent fill behind a same-colour icon reads as a
            bullseye rather than as a glyph. */}
        <circle
          cx={x}
          cy={mid}
          r={radius}
          fill={tone}
          fillOpacity={dim ? 0.5 : 1}
          stroke={row.color}
          strokeWidth={glyph.icon ? 2 : 1.5}
          strokeOpacity={dim ? 0.5 : 1}
        />
      </svg>

      {glyph.icon && (
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{ paddingLeft: (x - width / 2) * 2 }}
        >
          {/* Dark glyph on the bright disc: every tone is a saturated 400-level
              colour, so a near-black icon keeps contrast on all of them. */}
          <HugeiconsIcon
            icon={glyph.icon}
            size={glyph.size === "large" ? 11 : 9}
            strokeWidth={2.6}
            color="#0b1220"
            style={{ opacity: dim ? 0.6 : 0.92 }}
          />
        </span>
      )}
    </span>
  );
}

/**
 * Scroll rail: a continuous scrollbar carrying a tick at every user turn and a
 * coloured pip at every recorded key point, so a long transcript can be skimmed
 * and jumped through like a document index.
 */
export function MilestoneRail({
  ticks,
  marks,
  activePosition,
  onSeek,
}: {
  ticks: readonly { nodeId: string; position: number; preview: string; rowIndex: number }[];
  marks: readonly {
    nodeId: string;
    position: number;
    label: string;
    rowIndex: number;
    color: MarkColor;
  }[];
  activePosition: number;
  onSeek: (rowIndex: number) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="relative w-3.5 shrink-0 border-l border-border/50 bg-card/60">
      <div
        className="pointer-events-none absolute left-1/2 h-5 w-[3px] -translate-x-1/2 rounded-full bg-foreground/25 transition-[top] duration-150"
        style={{ top: `calc(${Math.min(1, Math.max(0, activePosition)) * 100}% - 10px)` }}
      />

      {ticks.map((tick) => (
        <button
          key={tick.nodeId}
          type="button"
          aria-label={`Jump to user turn: ${tick.preview || "no text"}`}
          onClick={() => onSeek(tick.rowIndex)}
          onMouseEnter={() => setHovered(tick.nodeId)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(tick.nodeId)}
          onBlur={() => setHovered(null)}
          className="absolute left-0 flex h-3 w-full cursor-pointer items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
          style={{ top: `calc(${tick.position * 100}% - 6px)` }}
        >
          <span
            className="h-[2px] w-2 rounded-full transition-colors"
            style={{ backgroundColor: TONE_COLOR.user, opacity: 0.7 }}
          />
          {hovered === tick.nodeId && tick.preview && (
            <span className="pointer-events-none absolute right-4 z-20 max-w-64 truncate rounded-md border border-border/70 bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-md">
              {tick.preview}
            </span>
          )}
        </button>
      ))}

      {marks.map((mark) => (
        <button
          key={`mark-${mark.nodeId}`}
          type="button"
          aria-label={`Jump to key point: ${mark.label}`}
          onClick={() => onSeek(mark.rowIndex)}
          onMouseEnter={() => setHovered(`mark-${mark.nodeId}`)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(`mark-${mark.nodeId}`)}
          onBlur={() => setHovered(null)}
          className="absolute left-0 flex h-3 w-full cursor-pointer items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
          style={{ top: `calc(${mark.position * 100}% - 6px)` }}
        >
          <span
            className={cn("size-1.5 rounded-full ring-1 ring-card", MARK_DOT_CLASS[mark.color])}
          />
          {hovered === `mark-${mark.nodeId}` && (
            <span className="pointer-events-none absolute right-4 z-20 max-w-64 truncate rounded-md border border-border/70 bg-popover px-1.5 py-0.5 text-[10px] font-medium text-popover-foreground shadow-md">
              {mark.label}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
