import {
  Delete02Icon,
  PauseIcon,
  PlayIcon,
  Radar01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { relativeCommitTime } from "@/modules/git-history/lib/relativeTime";
import { useWatchStore, watchCommands } from "./lib/watchStore";
import type { Watch } from "./lib/watch";

function intervalLabel(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function ago(atMs: number, nowSecs: number): string {
  const age = relativeCommitTime(Math.floor(atMs / 1000), nowSecs);
  return age === "now" ? "just now" : `${age} ago`;
}

function stateLine(watch: Watch, nowSecs: number): string {
  if (watch.lastError) return watch.lastError;
  if (watch.lastRunAt === undefined) return "Waiting for its first run";
  const ran = ago(watch.lastRunAt, nowSecs);
  if (watch.lastChangeAt === undefined) return `Checked ${ran}, no change yet`;
  return `Checked ${ran}, changed ${ago(watch.lastChangeAt, nowSecs)}`;
}

const ACTION_LABEL: Record<Watch["onChange"], string> = {
  notify: "notifies",
  agent: "wakes the agent",
  none: "records only",
};

/**
 * Status-bar entry for the agent's watches. Nothing renders, and no timer
 * runs, until a watch exists: the user must always be able to see and stop a
 * command that polls in the background.
 */
export function WatchersPill() {
  const watches = useWatchStore((s) => s.watches);
  const running = useWatchStore((s) => s.running);
  const [open, setOpen] = useState(false);
  const [nowSecs, setNowSecs] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!open) return;
    setNowSecs(Math.floor(Date.now() / 1000));
    const timer = setInterval(
      () => setNowSecs(Math.floor(Date.now() / 1000)),
      15_000,
    );
    return () => clearInterval(timer);
  }, [open]);

  if (watches.length === 0) return null;
  const active = watches.filter((w) => w.enabled).length;
  const failing = watches.some((w) => w.enabled && w.lastError);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${active} of ${watches.length} watches active`}
          aria-label="Watches"
          className={cn(
            "flex h-5.5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10.5px] transition-colors hover:bg-accent hover:text-foreground",
            failing
              ? "text-amber-600 dark:text-amber-400"
              : active > 0
                ? "text-foreground"
                : "text-muted-foreground",
          )}
        >
          <HugeiconsIcon
            icon={Radar01Icon}
            size={12}
            strokeWidth={1.75}
            className={cn(running.length > 0 && "animate-pulse")}
          />
          <span className="tabular-nums">{active}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-96 overflow-hidden rounded-lg border border-border/60 bg-popover/95 p-0 shadow-xl backdrop-blur-xl"
      >
        <div className="border-b border-border/60 px-3 py-2">
          <div className="text-[12px] font-medium">Watches</div>
          <div className="text-[10.5px] text-muted-foreground">
            Commands polled in the background that report when their output
            changes.
          </div>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {watches.map((watch) => {
            const busy = running.includes(watch.id);
            return (
              <li
                key={watch.id}
                className="flex items-start gap-2 px-3 py-2 hover:bg-accent/40"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    !watch.enabled
                      ? "bg-muted-foreground/30"
                      : watch.lastError
                        ? "bg-amber-500"
                        : "bg-emerald-500",
                    busy && "animate-pulse",
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <span className="truncate font-medium">{watch.name}</span>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">
                      every {intervalLabel(watch.intervalSeconds)},{" "}
                      {ACTION_LABEL[watch.onChange]}
                    </span>
                  </div>
                  <code
                    title={watch.command}
                    className="truncate font-mono text-[10.5px] text-muted-foreground"
                  >
                    {watch.command}
                  </code>
                  <span
                    className={cn(
                      "truncate text-[10.5px]",
                      watch.lastError
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground/80",
                    )}
                  >
                    {watch.enabled ? stateLine(watch, nowSecs) : "Paused"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <RowButton
                    label="Run now"
                    icon={RefreshIcon}
                    disabled={busy}
                    onClick={() => void watchCommands.run(watch.id).catch(() => {})}
                  />
                  <RowButton
                    label={watch.enabled ? "Pause" : "Resume"}
                    icon={watch.enabled ? PauseIcon : PlayIcon}
                    onClick={() =>
                      watchCommands.setEnabled(watch.id, !watch.enabled)
                    }
                  />
                  <RowButton
                    label="Delete"
                    icon={Delete02Icon}
                    onClick={() => watchCommands.remove(watch.id)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function RowButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof RefreshIcon;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.75} />
    </button>
  );
}
