import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Cancel01Icon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo } from "react";
import { projectAgentMonitor, type AgentMonitorRow } from "@/modules/agents/lib/monitor";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { useManagedAgentsStore } from "@/modules/agents/store/managedAgentsStore";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { TAB_COLOR_CSS, type Tab } from "@/modules/tabs";

const STATE_LABEL: Record<AgentMonitorRow["state"], string> = {
  "needs-input": "Needs input",
  working: "Working",
  finished: "Finished",
};

const STATE_CLASS: Record<AgentMonitorRow["state"], string> = {
  "needs-input": "bg-primary",
  working: "bg-amber-500",
  finished: "bg-muted-foreground/60",
};

/** Pi's first-party visual QA calls app.capture against this bounded target. */
export const AGENT_MONITOR_CAPTURE_TARGET = "agent-monitor";

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
  const managed = useManagedAgentsStore((state) => state.agents);
  const rows = useMemo(
    () => projectAgentMonitor({ sessions, managed, tabs }),
    [sessions, managed, tabs],
  );

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
            <p className="text-xs text-muted-foreground">No active terminal agents.</p>
            <p className="text-[11px] text-muted-foreground/70">
              Running supported agents appear here automatically.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((row) => (
              <li key={row.leafId}>
                <button
                  type="button"
                  onClick={() => onActivate(row.tabId, row.leafId)}
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
                        className={cn("absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-card", STATE_CLASS[row.state])}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {row.agent}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {STATE_LABEL[row.state]}
                    </span>
                  </div>
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
