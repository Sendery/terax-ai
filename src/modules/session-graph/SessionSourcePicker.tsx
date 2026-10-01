import { CheckmarkCircle02Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";

import type { SessionAgent } from "./lib/entries";
import type { SessionSourceGroup } from "./lib/terminalSources";

const AGENT_LABEL: Record<SessionAgent, string> = {
  pi: "pi",
  claude: "claude",
};

function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-3)}`;
}

function relativeTime(modifiedMs: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - modifiedMs) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Every transcript behind every open terminal.
 *
 * The panel normally follows the focused terminal, but resolving a transcript
 * from a directory is a heuristic and two agents in one directory look alike,
 * so any session has to be reachable by hand. Picking one pins the panel to it
 * until the user follows the focused terminal again.
 */
export function SessionSourcePicker({
  sources,
  boundTerminalKey,
  activeSessionId,
  pinned,
  now = Date.now(),
  onFollowFocused,
  onPickSession,
}: {
  sources: readonly SessionSourceGroup[];
  boundTerminalKey: string | null;
  activeSessionId: string | null;
  pinned: boolean;
  now?: number;
  onFollowFocused: () => void;
  onPickSession: (session: { id: string; agent: SessionAgent }) => void;
}) {
  return (
    <div className="flex max-h-[60vh] w-80 flex-col overflow-y-auto py-1">
      <button
        type="button"
        onClick={onFollowFocused}
        aria-current={pinned ? undefined : "true"}
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] outline-none",
          "focus-visible:bg-foreground/[0.07] hover:bg-foreground/[0.07]",
          pinned
            ? "text-muted-foreground"
            : "bg-foreground/[0.07] text-foreground",
        )}
      >
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          size={13}
          strokeWidth={2}
          className={cn("shrink-0", pinned && "opacity-0")}
        />
        Follow the focused terminal
      </button>

      {sources.length === 0 && (
        <p className="px-2.5 py-3 text-center text-[11px] text-muted-foreground">
          No terminal is open.
        </p>
      )}

      {sources.map((source) => (
        <div key={source.key} className="pt-1">
          <div className="flex items-baseline gap-1.5 px-2.5 py-0.5">
            <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {source.label}
            </span>
            {source.key === boundTerminalKey && (
              <span className="shrink-0 text-[9px] text-emerald-600 dark:text-emerald-400">
                focused
              </span>
            )}
          </div>
          <div
            className="truncate px-2.5 pb-0.5 text-[10px] text-muted-foreground/60"
            title={source.cwd}
          >
            {source.cwd}
          </div>

          {source.sessions.length === 0 ? (
            <p className="px-2.5 py-1 text-[10px] text-muted-foreground/60">
              No transcript in this directory.
            </p>
          ) : (
            source.sessions.map((session) => (
              <button
                key={`${source.key}:${session.id}`}
                type="button"
                onClick={() =>
                  onPickSession({ id: session.id, agent: session.agent })
                }
                aria-current={
                  session.id === activeSessionId ? "true" : undefined
                }
                title={session.id}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left text-[11px] outline-none",
                  "focus-visible:bg-foreground/[0.07] hover:bg-foreground/[0.07]",
                  session.id === activeSessionId
                    ? "bg-foreground/[0.07] text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={Copy01Icon}
                  size={12}
                  strokeWidth={2}
                  className="shrink-0 opacity-50"
                />
                <span className="shrink-0 font-medium">
                  {AGENT_LABEL[session.agent]}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                  {shortId(session.id)}
                </span>
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
                  {relativeTime(session.modifiedMs, now)}
                </span>
              </button>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
