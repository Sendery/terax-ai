import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Bookmark02Icon,
  Cancel01Icon,
  ComputerTerminal01Icon,
  GitBranchIcon,
  ListViewIcon,
  RefreshIcon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { native } from "@/modules/ai/lib/native";

import { availableActions, resumeCommand } from "./lib/actions";
import { branchOptions, sessionLineage } from "./lib/branches";
import {
  collapseByDensity,
  type GraphDensity,
  nextDensity,
  shortToolName,
  topTools,
} from "./lib/density";
import type { SessionAgent } from "./lib/entries";
import type { SessionCandidate } from "./lib/pickSession";
import type { SessionSourceGroup } from "./lib/terminalSources";
import { SessionBranchSwitcher } from "./SessionBranchSwitcher";
import { SessionSourcePicker } from "./SessionSourcePicker";
import { MARK_ACCENT_CLASS, MARK_CHIP_CLASS } from "./lib/markStyles";
import { nodeGlyph, toneForToolName, TONE_COLOR } from "./lib/nodeGlyph";
import {
  hasOutgoingEdge,
  nextMilestoneRow,
  previousMilestoneRow,
  railTicks,
  rowSummary,
} from "./lib/presentation";
import { useSessionMarks } from "./lib/useSessionMarks";
import { useSessionTranscript } from "./lib/useSessionTranscript";
import { visibleWindow } from "./lib/virtual";
import {
  MilestoneRail,
  ROW_HEIGHT,
  SessionGraphRailCell,
  railWidth,
} from "./SessionGraphRail";
import { SessionOutline } from "./SessionOutline";

const DENSITY_LABEL: Record<GraphDensity, string> = {
  overview: "Overview",
  compact: "Compact",
  full: "Full",
};

export function SessionGraphPanel({
  agent,
  sessionId,
  candidates = [],
  sources = [],
  boundTerminalKey = null,
  subtitle,
  onHide,
}: {
  agent: SessionAgent | null;
  sessionId: string | null;
  /** Sessions found for this directory, used to walk the fork tree. */
  candidates?: readonly SessionCandidate[];
  /** Every open terminal with its transcripts, for the session picker. */
  sources?: readonly SessionSourceGroup[];
  /** Key of the terminal the panel currently follows. */
  boundTerminalKey?: string | null;
  subtitle: string | null;
  onHide: () => void;
}) {
  // Two ways to leave the transcript the focused terminal resolves to.
  //
  // Fork navigation is local: it belongs to the terminal in view, so rebinding
  // to another terminal drops it. A session picked by hand is pinned: the user
  // asked for that transcript specifically and it survives focus changes until
  // they follow the focused terminal again.
  const [selection, setSelection] = useState<{
    id: string;
    agent: SessionAgent | null;
    pinned: boolean;
  } | null>(null);
  const [branchHead, setBranchHead] = useState<string | null>(null);

  const activeSessionId = selection?.id ?? sessionId;
  const activeAgent = selection?.agent ?? agent;
  const pinned = selection?.pinned ?? false;

  useEffect(() => {
    void sessionId;
    setSelection((current) => (current?.pinned ? current : null));
    setBranchHead(null);
    setSelectedId(null);
  }, [sessionId]);

  const { graph, parsed, loading, error, live, reload } = useSessionTranscript(
    activeAgent,
    activeSessionId,
    branchHead,
  );
  const marks = useSessionMarks(activeSessionId);

  const [density, setDensity] = useState<GraphDensity>("overview");
  const [expandedTurns, setExpandedTurns] = useState<ReadonlySet<number>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  const markedIds = useMemo(() => new Set(marks.marks.keys()), [marks.marks]);

  const entries = useMemo(
    () => collapseByDensity(graph.rows, density, expandedTurns, markedIds),
    [graph.rows, density, expandedTurns, markedIds],
  );

  const rowIndexByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    graph.rows.forEach((row, index) => {
      map.set(row.node.id, index);
    });
    return map;
  }, [graph.rows]);

  const ticks = useMemo(
    () => railTicks(graph.milestones, graph.rows.length),
    [graph.milestones, graph.rows.length],
  );

  const railMarks = useMemo(
    () =>
      [...marks.marks.values()].flatMap((mark) => {
        const rowIndex = rowIndexByNodeId.get(mark.nodeId);
        if (rowIndex === undefined || graph.rows.length === 0) return [];
        return [
          {
            nodeId: mark.nodeId,
            rowIndex,
            label: mark.label,
            color: mark.color,
            position: graph.rows.length <= 1 ? 0 : rowIndex / graph.rows.length,
          },
        ];
      }),
    [marks.marks, rowIndexByNodeId, graph.rows.length],
  );

  const totalSessions = useMemo(
    () => sources.reduce((sum, source) => sum + source.sessions.length, 0),
    [sources],
  );

  const spurCount = graph.branches.filter((branch) => !branch.isActive).length;

  const forks = useMemo(
    () => (parsed ? branchOptions(parsed.nodes, branchHead ?? parsed.headId ?? "") : []),
    [parsed, branchHead],
  );

  // A pinned session belongs to another terminal, so its forks live in that
  // terminal's directory, not the bound one's.
  const lineageCandidates = useMemo(() => {
    if (!activeSessionId) return candidates;
    const owning = sources.find((source) =>
      source.sessions.some((session) => session.id === activeSessionId),
    );
    return owning ? owning.sessions : candidates;
  }, [sources, candidates, activeSessionId]);

  const lineage = useMemo(
    () =>
      activeSessionId
        ? sessionLineage(
            lineageCandidates.map((candidate) => ({
              id: candidate.id,
              parentSessionId: candidate.parentSessionId ?? null,
            })),
            activeSessionId,
          )
        : { parentId: null, childIds: [] },
    [lineageCandidates, activeSessionId],
  );

  const candidateById = useMemo(
    () =>
      new Map(lineageCandidates.map((candidate) => [candidate.id, candidate])),
    [lineageCandidates],
  );

  // Only the visible slice is mounted: each row carries an inline SVG, and a
  // transcript can run to thousands of entries.
  const window_ = visibleWindow({
    total: entries.length,
    rowHeight: ROW_HEIGHT,
    scrollTop,
    viewportHeight,
  });
  const slice = entries.slice(window_.start, window_.end);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const toggleTurn = useCallback((turnIndex: number) => {
    setExpandedTurns((current) => {
      const next = new Set(current);
      if (next.has(turnIndex)) next.delete(turnIndex);
      else next.add(turnIndex);
      return next;
    });
  }, []);

  /** Scrolls an unfolded row index into view, expanding its turn if needed. */
  const seekToRow = useCallback(
    (rowIndex: number) => {
      const row = graph.rows[rowIndex];
      if (!row) return;
      setExpandedTurns((current) => {
        if (current.has(row.turnIndex)) return current;
        const next = new Set(current);
        next.add(row.turnIndex);
        return next;
      });
      setSelectedId(row.node.id);
    },
    [graph.rows],
  );

  // Scrolling happens after the expansion re-renders, so the target row exists.
  useEffect(() => {
    if (!selectedId) return;
    const index = entries.findIndex(
      (entry) => entry.kind === "row" && entry.row.node.id === selectedId,
    );
    if (index < 0) return;
    const container = listRef.current;
    if (!container) return;
    const top = index * ROW_HEIGHT;
    // Only scroll when the target is out of view, so clicking a row is not jumpy.
    if (top < container.scrollTop || top > container.scrollTop + container.clientHeight - ROW_HEIGHT) {
      container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), behavior: "smooth" });
    }
  }, [selectedId, entries]);

  const selectedRowIndex = selectedId ? (rowIndexByNodeId.get(selectedId) ?? -1) : -1;

  const jump = useCallback(
    (direction: "next" | "previous") => {
      const from = selectedRowIndex >= 0 ? selectedRowIndex : 0;
      const target =
        direction === "next"
          ? nextMilestoneRow(graph.milestones, from)
          : previousMilestoneRow(graph.milestones, from);
      if (target !== null) seekToRow(target);
    },
    [graph.milestones, seekToRow, selectedRowIndex],
  );

  const onScroll = useCallback(() => {
    const container = listRef.current;
    if (container) setScrollTop(container.scrollTop);
  }, []);

  /** Fraction of the transcript currently on screen, for the rail indicator. */
  const railPosition =
    entries.length <= 1 ? 0 : (window_.start + slice.length / 2) / entries.length;

  const currentRowIndex = useMemo(() => {
    const firstVisible = entries[window_.start];
    if (firstVisible?.kind === "row") {
      return rowIndexByNodeId.get(firstVisible.row.node.id) ?? 0;
    }
    return firstVisible?.kind === "group" ? firstVisible.firstRowIndex : 0;
  }, [entries, window_.start, rowIndexByNodeId]);

  const startEditing = useCallback(
    (nodeId: string, existing: string) => {
      setEditingNodeId(nodeId);
      setDraftLabel(existing);
    },
    [],
  );

  /**
   * Runs an action on one entry. Everything that writes asks first, and the
   * original transcript is never modified: branching creates a new session.
   */
  const runAction = useCallback(
    async (actionId: string, nodeId: string) => {
      if (!agent || !activeSessionId) return;

      if (actionId === "resume") {
        const command = resumeCommand(agent, activeSessionId);
        if (!command) {
          toast.error("This session id cannot be resumed from a command line.");
          return;
        }
        await navigator.clipboard.writeText(command);
        toast.success("Resume command copied", { description: command });
        return;
      }

      if (actionId === "branch") {
        const confirmed = window.confirm(
          "Create a new session containing the history up to this point?\n\n" +
            "The current session is not modified.",
        );
        if (!confirmed) return;
        try {
          const created = await native.agentSessionBranch(activeSessionId, nodeId);
          const command = resumeCommand("pi", created.sessionId);
          if (command) await navigator.clipboard.writeText(command);
          toast.success(`Branched ${created.entryCount} entries`, {
            description: command
              ? `${created.sessionId} — resume command copied`
              : created.sessionId,
          });
        } catch (cause) {
          toast.error("Could not branch this session", {
            description: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    },
    [agent, activeSessionId],
  );

  const commitLabel = useCallback(() => {
    if (!editingNodeId) return;
    const label = draftLabel.trim();
    if (label) {
      if (marks.marks.has(editingNodeId)) marks.rename(editingNodeId, label);
      else marks.add(editingNodeId, label);
    } else if (marks.marks.has(editingNodeId)) {
      marks.remove(editingNodeId);
    }
    setEditingNodeId(null);
    setDraftLabel("");
  }, [draftLabel, editingNodeId, marks]);

  const width = railWidth(graph.laneCount);

  return (
    <aside
      data-capture-target="session-graph"
      className="flex h-full min-h-0 flex-col border-l border-border/60 bg-card"
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <HugeiconsIcon
          icon={GitBranchIcon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <h2 className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden whitespace-nowrap text-xs font-semibold tracking-wide text-foreground">
          <span className="shrink-0">History</span>
          {graph.milestones.length > 0 && (
            <span
              className="shrink-0 tabular-nums text-muted-foreground"
              title={`${graph.milestones.length} user turns`}
            >
              {graph.milestones.length}
            </span>
          )}
          {spurCount > 0 && (
            <span
              className="shrink-0 text-[10px] font-normal text-purple-600 dark:text-purple-400"
              title={`${spurCount} abandoned branch${spurCount === 1 ? "" : "es"}`}
            >
              · {spurCount} br
            </span>
          )}
          {live && (
            <span
              className="shrink-0 text-[10px] font-normal text-emerald-600 dark:text-emerald-400"
              title="Following a running agent"
            >
              live
            </span>
          )}
        </h2>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Inspect a session from any open terminal, ${totalSessions} available`}
              title="Sessions of the open terminals"
              className={cn(
                "size-6",
                pinned
                  ? "text-sky-600 dark:text-sky-400"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <HugeiconsIcon
                icon={ComputerTerminal01Icon}
                size={13}
                strokeWidth={2}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <SessionSourcePicker
              sources={sources}
              boundTerminalKey={boundTerminalKey}
              activeSessionId={activeSessionId}
              pinned={pinned}
              onFollowFocused={() => {
                setSelection(null);
                setBranchHead(null);
                setSelectedId(null);
              }}
              onPickSession={(session) => {
                setSelection(
                  session.id === sessionId
                    ? null
                    : { id: session.id, agent: session.agent, pinned: true },
                );
                setBranchHead(null);
                setSelectedId(null);
              }}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Switch branch or forked session, ${forks.length} rewind points`}
              title="Branches and forks"
              className={cn(
                "size-6",
                forks.length > 0 || lineage.parentId || lineage.childIds.length > 0
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={GitBranchIcon} size={13} strokeWidth={2} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <SessionBranchSwitcher
              forks={forks}
              onSwitchBranch={(tipId) => {
                setBranchHead(tipId);
                setSelectedId(tipId);
              }}
              parentSession={
                lineage.parentId ? (candidateById.get(lineage.parentId) ?? null) : null
              }
              childSessions={lineage.childIds.flatMap((id) => {
                const found = candidateById.get(id);
                return found ? [found] : [];
              })}
              onOpenSession={(id) => {
                setSelection(
                  id === sessionId ? null : { id, agent: activeAgent, pinned },
                );
                setBranchHead(null);
                setSelectedId(null);
              }}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open session outline"
              title="Outline"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <HugeiconsIcon icon={ListViewIcon} size={13} strokeWidth={2} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <SessionOutline
              milestones={graph.milestones}
              marks={marks.marks}
              currentRowIndex={currentRowIndex}
              rowIndexByNodeId={rowIndexByNodeId}
              onJump={seekToRow}
            />
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          aria-label={`Zoom out, currently ${DENSITY_LABEL[density]}`}
          title={`Zoom out (${DENSITY_LABEL[density]})`}
          disabled={density === "overview"}
          onClick={() => setDensity((current) => nextDensity(current, -1))}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ZoomOutAreaIcon} size={13} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Zoom in, currently ${DENSITY_LABEL[density]}`}
          title={`Zoom in (${DENSITY_LABEL[density]})`}
          disabled={density === "full"}
          onClick={() => setDensity((current) => nextDensity(current, 1))}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ZoomInAreaIcon} size={13} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Jump to previous user turn"
          title="Previous turn"
          disabled={graph.milestones.length === 0}
          onClick={() => jump("previous")}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={13} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Jump to next user turn"
          title="Next turn"
          disabled={graph.milestones.length === 0}
          onClick={() => jump("next")}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={13} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Reload session history"
          title="Reload"
          onClick={reload}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide session history panel"
          title="Hide"
          onClick={onHide}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
        </Button>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-2.5 py-1 text-[10px] text-muted-foreground">
        <span className="truncate">{subtitle ?? "\u00a0"}</span>
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
          {branchHead && (
            <button
              type="button"
              onClick={() => setBranchHead(null)}
              title="Return to the branch the agent is on"
              className="cursor-pointer rounded-sm border border-purple-500/40 bg-purple-500/12 px-1 text-purple-600 dark:text-purple-300"
            >
              on branch ×
            </button>
          )}
          {selection && (
            <button
              type="button"
              onClick={() => {
                setSelection(null);
                setBranchHead(null);
                setSelectedId(null);
              }}
              title={
                selection.pinned
                  ? "Follow the focused terminal again"
                  : "Return to the session of this terminal"
              }
              className="cursor-pointer rounded-sm border border-sky-500/40 bg-sky-500/12 px-1 text-sky-600 dark:text-sky-300"
            >
              {selection.pinned ? "pinned ×" : "forked ×"}
            </button>
          )}
          <span>
            {DENSITY_LABEL[density]} · {entries.length}
          </span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          {error ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{error}</p>
          ) : loading && graph.rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Reading transcript…
            </p>
          ) : graph.rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {activeAgent && activeSessionId
                ? "No history in this session yet."
                : "Select an agent terminal to see its history."}
            </p>
          ) : (
            <>
              <div style={{ height: window_.padTop }} />
              <ul>
                {slice.map((entry) => {
                  if (entry.kind === "group") {
                    const { shown, extra } = topTools(entry.tools, 3);
                    return (
                      <li key={`group-${entry.turnIndex}-${entry.firstRowIndex}`}>
                        <button
                          type="button"
                          onClick={() => toggleTurn(entry.turnIndex)}
                          style={{ height: ROW_HEIGHT, paddingLeft: width + 6 }}
                          aria-label={`Expand ${entry.hiddenCount} hidden steps`}
                          className="flex w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-[10px] text-muted-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground"
                        >
                          <span className="shrink-0 rounded-full border border-border/60 bg-foreground/[0.05] px-1.5 py-px tabular-nums">
                            {entry.hiddenCount}
                          </span>
                          {/* Each tool keeps its family colour, so a collapsed
                              run still says what kind of work it was. */}
                          {shown.map((tool) => (
                            <span
                              key={tool.name}
                              className="shrink-0 rounded-sm px-1 font-mono"
                              style={{
                                color: TONE_COLOR[toneForToolName(tool.name)],
                                backgroundColor: `${TONE_COLOR[toneForToolName(tool.name)]}14`,
                              }}
                            >
                              {tool.count > 1
                                ? `${shortToolName(tool.name)}×${tool.count}`
                                : shortToolName(tool.name)}
                            </span>
                          ))}
                          {extra > 0 && (
                            <span className="shrink-0 text-muted-foreground/60">+{extra}</span>
                          )}
                          {entry.hasBranch && (
                            <span className="shrink-0 text-purple-600 dark:text-purple-400">
                              branch
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  }

                  const { row } = entry;
                  const summary = rowSummary(row.node);
                  const piLabel = parsed?.labels.get(row.node.id);
                  const mark = marks.marks.get(row.node.id);
                  const isSelected = row.node.id === selectedId;
                  const isEditing = editingNodeId === row.node.id;

                  const glyph = nodeGlyph(row.node);
                  // Rows of an abandoned branch are tinted in their lane colour,
                  // the way a git client shades a side branch, so a spur reads as
                  // one block instead of a run of dimmed text.
                  const tint = !row.isOnActiveBranch
                    ? { backgroundColor: `${row.color}14`, boxShadow: `inset 2px 0 0 0 ${row.color}` }
                    : summary.isEmphasis
                      ? { backgroundColor: `${TONE_COLOR.user}0f` }
                      : undefined;

                  const actions = agent
                    ? availableActions(agent, row.node, {
                        codeSnapshotFiles: parsed?.codeSnapshots.get(row.node.id)?.length ?? 0,
                      })
                    : [];

                  return (
                    <li key={row.node.id}>
                      <ContextMenu>
                      <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          "group flex w-full items-center gap-1 pr-1",
                          isSelected ? "bg-foreground/[0.09]" : "hover:bg-foreground/[0.05]",
                          mark && MARK_ACCENT_CLASS[mark.color],
                        )}
                        style={{ height: ROW_HEIGHT, ...(isSelected ? {} : tint) }}
                      >
                        <HoverCard openDelay={350} closeDelay={80}>
                          <HoverCardTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setSelectedId(row.node.id)}
                              onDoubleClick={() => toggleTurn(row.turnIndex)}
                              aria-current={isSelected ? "true" : undefined}
                              aria-label={`${
                                summary.isEmphasis ? "User turn" : "Agent step"
                              }: ${summary.label}${
                                row.isOnActiveBranch ? "" : " (abandoned branch)"
                              }${mark ? `, marked ${mark.label}` : ""}`}
                              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none focus-visible:bg-foreground/[0.06]"
                            >
                              <SessionGraphRailCell
                                row={row}
                                laneCount={graph.laneCount}
                                isFirst={row.parentRowIndex === null}
                                isLast={!hasOutgoingEdge(row)}
                                selected={isSelected}
                              />
                              <span
                                className={cn(
                                  "truncate text-[11px]",
                                  summary.isEmphasis
                                    ? "font-semibold text-foreground"
                                    : "text-muted-foreground",
                                  !row.isOnActiveBranch && "opacity-70",
                                )}
                              >
                                {summary.label}
                              </span>
                              {summary.detail && (
                                <span
                                  className="shrink-0 rounded-sm px-1 text-[9px] font-medium"
                                  style={{
                                    color: TONE_COLOR[glyph.tone],
                                    backgroundColor: `${TONE_COLOR[glyph.tone]}1a`,
                                  }}
                                >
                                  {summary.detail}
                                </span>
                              )}
                            </button>
                          </HoverCardTrigger>
                          <HoverCardContent side="left" align="start" className="w-96">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                <span>{summary.isEmphasis ? "User turn" : row.node.kind}</span>
                                {!row.isOnActiveBranch && (
                                  <span className="text-purple-600 dark:text-purple-400">
                                    abandoned branch
                                  </span>
                                )}
                                {row.isBranchPoint && (
                                  <span className="text-purple-600 dark:text-purple-400">
                                    branch point
                                  </span>
                                )}
                              </div>
                              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-foreground">
                                {row.node.preview || summary.label}
                              </p>
                              {row.node.toolNames.length > 0 && (
                                <p className="font-mono text-[10px] text-muted-foreground">
                                  {row.node.toolNames.join(", ")}
                                </p>
                              )}
                              {row.node.at > 0 && (
                                <p className="text-[10px] tabular-nums text-muted-foreground/70">
                                  {new Date(row.node.at).toLocaleString()}
                                </p>
                              )}
                            </div>
                          </HoverCardContent>
                        </HoverCard>

                        {mark && !isEditing && (
                          <button
                            type="button"
                            onClick={() => startEditing(row.node.id, mark.label)}
                            title="Edit key point"
                            className={cn(
                              "shrink-0 cursor-pointer truncate rounded-sm border px-1 text-[9px] font-medium",
                              MARK_CHIP_CLASS[mark.color],
                            )}
                          >
                            {mark.label}
                          </button>
                        )}
                        {piLabel && (
                          <span
                            title="Label recorded by pi"
                            className="shrink-0 truncate rounded-sm border border-border/60 bg-foreground/[0.04] px-1 text-[9px] text-muted-foreground"
                          >
                            {piLabel}
                          </span>
                        )}

                        {isEditing ? (
                          <input
                            ref={(element) => element?.focus()}
                            value={draftLabel}
                            onChange={(event) => setDraftLabel(event.target.value)}
                            onBlur={commitLabel}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitLabel();
                              if (event.key === "Escape") {
                                setEditingNodeId(null);
                                setDraftLabel("");
                              }
                            }}
                            placeholder="Label this point"
                            aria-label="Key point label"
                            className="w-28 shrink-0 rounded-sm border border-border/70 bg-background px-1 text-[10px] text-foreground outline-none"
                          />
                        ) : (
                          !mark && (
                            <button
                              type="button"
                              onClick={() => startEditing(row.node.id, "")}
                              aria-label="Mark this point"
                              title="Mark this point"
                              className="shrink-0 cursor-pointer text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70 hover:!text-foreground focus-visible:text-foreground"
                            >
                              <HugeiconsIcon icon={Bookmark02Icon} size={11} strokeWidth={2} />
                            </button>
                          )
                        )}
                      </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-72">
                        <ContextMenuItem
                          onSelect={() =>
                            startEditing(row.node.id, marks.marks.get(row.node.id)?.label ?? "")
                          }
                        >
                          {mark ? "Edit key point" : "Mark this point"}
                        </ContextMenuItem>
                        {mark && (
                          <ContextMenuItem onSelect={() => marks.remove(row.node.id)}>
                            Remove key point
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        {actions.map((action) => (
                          <ContextMenuItem
                            key={action.id}
                            disabled={!action.enabled}
                            title={action.reason}
                            onSelect={() => void runAction(action.id, row.node.id)}
                          >
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                              <span className="truncate">{action.label}</span>
                              {action.detail && (
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {action.detail}
                                </span>
                              )}
                            </span>
                          </ContextMenuItem>
                        ))}
                      </ContextMenuContent>
                      </ContextMenu>
                    </li>
                  );
                })}
              </ul>
              <div style={{ height: window_.padBottom }} />
            </>
          )}
        </div>

        {ticks.length > 0 && (
          <MilestoneRail
            ticks={ticks}
            marks={railMarks}
            activePosition={railPosition}
            onSeek={seekToRow}
          />
        )}
      </div>
    </aside>
  );
}
