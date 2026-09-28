import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { Cancel01Icon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef } from "react";
import {
  describeMonitorRow,
  projectAgentMonitor,
  type AgentMonitorRow,
} from "@/modules/agents/lib/monitor";
import { refreshDigest } from "@/modules/agents/lib/digests";
import {
  displayAgent,
  formatSessionStart,
  formatSince,
} from "@/modules/agents/lib/format";
import { useNow } from "@/modules/agents/lib/useNow";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { useManagedAgentsStore } from "@/modules/agents/store/managedAgentsStore";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { findPaneCwd } from "@/modules/agents/lib/tabTarget";
import { labelFor, TAB_COLOR_CSS, type Tab } from "@/modules/tabs";

/** Pi's first-party visual QA calls app.capture against this bounded target. */
export const AGENT_MONITOR_CAPTURE_TARGET = "agent-monitor";

/**
 * One colour per situation, the same ones the native notification badge uses,
 * so a session reads the same in the monitor and in Notification Center.
 */
function stateTone(row: AgentMonitorRow): { dot: string; pill: string } {
  switch (row.reason ?? row.state) {
    case "permission":
      return {
        dot: "bg-amber-500",
        pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      };
    case "question":
      return {
        dot: "bg-violet-500",
        pill: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
      };
    case "idle":
    case "finished":
      return {
        dot: "bg-emerald-500",
        pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      };
    case "working":
      return {
        dot: "bg-sky-500 animate-pulse",
        pill: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
      };
    default:
      return {
        dot: "bg-orange-500",
        pill: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
      };
  }
}

const TASK_LABEL: Record<AgentMonitorRow["tasks"][number]["kind"], string> = {
  subagent: "Subagent",
  monitor: "Monitor",
  background: "Background",
  loop: "Loop",
};

/** Everything the row has no room for, shown on hover. */
function AgentMonitorDetails({
  row,
  now,
}: {
  row: AgentMonitorRow;
  now: number;
}) {
  const hasLinks = row.prs.length > 0 || row.artifacts.length > 0;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold text-foreground">{row.sessionName}</span>
        <span className="text-muted-foreground">
          {[row.tabLabel, displayAgent(row.agent), row.stateLabel]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      {row.pendingQuestion ? (
        <section className="rounded-lg bg-violet-500/10 p-2">
          <h3 className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Waiting on your answer
          </h3>
          <p className="leading-relaxed text-foreground">
            {row.pendingQuestion}
          </p>
        </section>
      ) : null}

      {row.summary ? (
        <section>
          <h3 className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recap
          </h3>
          <p className="whitespace-pre-line leading-relaxed text-foreground/90">
            {row.summary}
          </p>
        </section>
      ) : (
        <p className="text-muted-foreground">No recap yet.</p>
      )}

      {row.goal ? (
        <section>
          <h3 className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Goal
          </h3>
          <p className="leading-relaxed text-foreground/90">{row.goal}</p>
        </section>
      ) : null}

      {row.tasks.length > 0 ? (
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Running
          </h3>
          <ul className="flex flex-col gap-1">
            {row.tasks.map((task) => (
              <li
                key={`${task.kind}-${task.startedAt}-${task.label}`}
                className="flex min-w-0 items-baseline gap-1.5"
              >
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  {TASK_LABEL[task.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground/90">
                  {task.label || TASK_LABEL[task.kind]}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatSince(task.startedAt, now)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hasLinks ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Produced
          </h3>
          {row.prs.map((pr) => (
            <button
              key={pr.url}
              type="button"
              onClick={() => void openUrl(pr.url)}
              className="truncate text-left text-primary underline-offset-2 hover:underline"
            >
              PR #{pr.number}
              {pr.repo ? (
                <span className="text-muted-foreground"> {pr.repo}</span>
              ) : null}
            </button>
          ))}
          {row.artifacts.map((artifact) => (
            <button
              key={artifact.url}
              type="button"
              onClick={() => void openUrl(artifact.url)}
              className="truncate text-left text-primary underline-offset-2 hover:underline"
            >
              {artifact.title || "Artifact"}
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/**
 * One session in the monitor.
 *
 * Exported and free of stores so its presentation can be asserted directly:
 * a Zustand hook read through `renderToStaticMarkup` returns the store's
 * *initial* state, so a test that seeds a store and renders the panel would see
 * an empty list no matter what it seeded.
 */
export function AgentMonitorRowView({
  row,
  now,
  onActivate,
  onHover,
}: {
  row: AgentMonitorRow;
  now: number;
  onActivate: (tabId: number, leafId: number) => void;
  /** Called as the details open, so they show the transcript as it is now. */
  onHover?: (leafId: number) => void;
}) {
  const startedAt = formatSessionStart(row.startedAt, now);
  const notified =
    row.lastNotificationAt === null
      ? "No notifications yet"
      : `Notified ${formatSince(row.lastNotificationAt, now)}`;
  // The visible text names the session, so the provider, the state dot and both
  // ages have to be composed into the accessible name explicitly.
  const described = describeMonitorRow(row, now);
  const tone = stateTone(row);

  return (
    <HoverCard
      openDelay={350}
      closeDelay={120}
      onOpenChange={(open) => {
        if (open) onHover?.(row.leafId);
      }}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => onActivate(row.tabId, row.leafId)}
          aria-label={described}
          className="relative flex w-full flex-col gap-1 overflow-hidden rounded-md p-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {row.tabColor ? (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1"
              style={{ backgroundColor: TAB_COLOR_CSS[row.tabColor] }}
            />
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative shrink-0">
              <AgentIcon
                agent={row.agent}
                harness={row.harness}
                size={16}
                className="text-muted-foreground"
              />
              <span
                aria-hidden
                className={cn(
                  "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-card",
                  tone.dot,
                )}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {row.sessionName}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium",
                tone.pill,
              )}
            >
              {row.stateLabel}
            </span>
          </div>
          {row.tabLabel ? (
            <div className="flex min-w-0 items-center gap-1.5 pl-3.5 text-[11px] text-muted-foreground">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                style={
                  row.tabColor
                    ? { backgroundColor: TAB_COLOR_CSS[row.tabColor] }
                    : undefined
                }
              />
              <span className="truncate">{row.tabLabel}</span>
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-1.5 pl-3.5 text-[11px] text-muted-foreground">
            {startedAt ? (
              <span className="shrink-0 tabular-nums">Started {startedAt}</span>
            ) : null}
            {startedAt ? <span aria-hidden>·</span> : null}
            <span className="truncate">{notified}</span>
          </div>
          {row.taskSummary || row.prs.length > 0 || row.artifacts.length > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1 pl-3.5">
              {row.taskSummary ? (
                <span className="rounded bg-sky-500/10 px-1 text-[10px] text-sky-700 dark:text-sky-300">
                  {row.taskSummary}
                </span>
              ) : null}
              {row.prs.slice(-3).map((pr) => (
                <span
                  key={pr.url}
                  className="rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground"
                >
                  PR #{pr.number}
                </span>
              ))}
              {row.artifacts.length > 0 ? (
                <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  {row.artifacts.length}{" "}
                  {row.artifacts.length === 1 ? "artifact" : "artifacts"}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex min-w-0 items-center gap-1.5 pl-3.5 text-[11px] text-muted-foreground">
            <span className="shrink-0">{row.integrationLabel}</span>
            {row.task ? <span aria-hidden>·</span> : null}
            {row.task ? <span className="truncate">{row.task}</span> : null}
          </div>
          {row.cwd ? (
            <span className="truncate pl-3.5 font-mono text-[10px] text-muted-foreground/80">
              {row.cwd}
            </span>
          ) : null}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="start"
        className="w-80 rounded-xl p-3"
      >
        <AgentMonitorDetails row={row} now={now} />
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * While the monitor is open, digests are refreshed on this cadence: subagents
 * and monitors come and go without any hook firing. A refresh reads only what
 * was appended, so it costs next to nothing, and nothing runs while closed.
 */
const OPEN_REFRESH_MS = 10_000;

export function AgentMonitorPanel({
  onActivate,
  onHide,
  tabs,
}: {
  onActivate: (tabId: number, leafId: number) => void;
  onHide: () => void;
  tabs: readonly Tab[];
}) {
  const sessions = useAgentStore((state) => state.sessions);
  const notifications = useAgentStore((state) => state.notifications);
  const digests = useAgentStore((state) => state.digests);
  const managed = useManagedAgentsStore((state) => state.agents);
  // The tab module owns how a tab is named; the projection only consumes the result.
  const monitorTabs = useMemo(
    () =>
      tabs.map((tab) => ({
        id: tab.id,
        color: tab.color,
        private: tab.kind === "terminal" ? tab.private : undefined,
        label: labelFor(tab),
      })),
    [tabs],
  );
  const rows = useMemo(
    () =>
      projectAgentMonitor({
        sessions,
        managed,
        tabs: monitorTabs,
        notifications,
        digests,
      }),
    [sessions, managed, monitorTabs, notifications, digests],
  );
  // Ages are only rendered when there is a row, so an empty monitor holds no timer.
  const now = useNow(rows.length > 0);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const leafIds = rows.map((row) => row.leafId).join(",");
  useEffect(() => {
    if (!leafIds) return;
    const refreshAll = () => {
      for (const id of leafIds.split(",").map(Number)) {
        void refreshDigest(id, findPaneCwd(tabsRef.current, id));
      }
    };
    refreshAll();
    const timer = window.setInterval(refreshAll, OPEN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [leafIds]);

  return (
    <aside
      aria-label="Agent monitor"
      data-capture-target="agent-monitor"
      className="flex h-full min-h-0 flex-col border-l border-border/60 bg-card"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <HugeiconsIcon
          icon={TerminalIcon}
          size={15}
          strokeWidth={1.9}
          className="text-muted-foreground"
        />
        <h2 className="flex min-w-0 flex-1 items-baseline gap-1.5 text-xs font-semibold tracking-wide text-foreground">
          <span>Agent monitor</span>
          {rows.length > 0 ? (
            <span className="text-muted-foreground">{rows.length}</span>
          ) : null}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide agent monitor"
          title="Hide agent monitor"
          onClick={onHide}
          className="size-6 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <HugeiconsIcon
              icon={TerminalIcon}
              size={26}
              strokeWidth={1.5}
              className="text-muted-foreground/40"
            />
            <p className="text-xs text-muted-foreground">
              No active terminal agents.
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              Running supported agents appear here automatically.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <li key={row.leafId}>
                <AgentMonitorRowView
                  row={row}
                  now={now}
                  onActivate={onActivate}
                  onHover={(leafId) =>
                    void refreshDigest(
                      leafId,
                      findPaneCwd(tabsRef.current, leafId),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
