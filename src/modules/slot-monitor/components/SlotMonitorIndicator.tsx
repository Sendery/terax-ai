import { BulbIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  SLOT_SERVICE_LABELS,
  SLOT_SERVICES,
  type SlotHealth,
  type SlotInfo,
  type SlotServiceStatus,
} from "../lib/slots";
import { useSlotMonitor } from "../lib/useSlotMonitor";

const HEALTH_META: Record<
  SlotHealth,
  { label: string; icon: string; dot: string; glow: string }
> = {
  green: {
    label: "healthy",
    icon: "text-emerald-500",
    dot: "bg-emerald-500",
    glow: "drop-shadow-[0_0_5px_rgba(16,185,129,0.65)]",
  },
  yellow: {
    label: "idle or partial",
    icon: "text-amber-500",
    dot: "bg-amber-500",
    glow: "drop-shadow-[0_0_5px_rgba(245,158,11,0.6)]",
  },
  red: {
    label: "needs attention",
    icon: "text-rose-500",
    dot: "bg-rose-500",
    glow: "drop-shadow-[0_0_5px_rgba(244,63,94,0.6)]",
  },
};

const SERVICE_META: Record<
  SlotServiceStatus,
  { label: string; dot: string; text: string }
> = {
  up: { label: "up", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  idle: { label: "idle", dot: "bg-muted-foreground/60", text: "text-muted-foreground" },
  down: { label: "down", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  off: { label: "off", dot: "bg-muted-foreground/25", text: "text-muted-foreground/60" },
};

const STATUS_META: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  stopped: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  idle: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  setup: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
};

function statusClass(status: string): string {
  return STATUS_META[status] ?? "bg-rose-500/15 text-rose-600 dark:text-rose-400";
}

function DockerBadge({ status }: { status: string }) {
  const tone =
    status === "running"
      ? "bg-emerald-500"
      : status === "exited"
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("size-1.5 rounded-full", tone)} aria-hidden />
      {status}
    </span>
  );
}

function SlotDashboard({ slot, health }: { slot: SlotInfo; health: SlotHealth }) {
  const meta = HEALTH_META[health];
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("size-2.5 rounded-full", meta.dot)} aria-hidden />
          <span className="text-[13px] font-semibold">Slot {slot.slot}</span>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            statusClass(slot.status),
          )}
        >
          {slot.status}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-muted-foreground">branch</span>
          <span className="truncate font-medium">{slot.branch}</span>
        </div>
        {slot.ticket ? (
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-muted-foreground">ticket</span>
            <span className="font-medium text-sky-600 dark:text-sky-400">
              {slot.ticket}
            </span>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-muted-foreground">git</span>
          <span className="truncate">
            <span
              className={cn(
                "font-medium",
                slot.git.dirtyCount > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {slot.git.dirtyCount > 0 ? `${slot.git.dirtyCount} changed` : "clean"}
            </span>
            <span className="text-muted-foreground"> · {slot.git.lastCommit}</span>
          </span>
        </div>
      </div>

      <div className="border-t border-border/60 pt-2">
        <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>services</span>
          <span>{slot.tmux.running ? slot.tmux.session : "no tmux session"}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {SLOT_SERVICES.map((svc) => {
            const svcMeta = SERVICE_META[slot.tmux.services[svc]];
            return (
              <div key={svc} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className={cn("size-1.5 rounded-full", svcMeta.dot)} aria-hidden />
                  {SLOT_SERVICE_LABELS[svc]}
                </span>
                <span className={cn("font-medium", svcMeta.text)}>{svcMeta.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">rails</span>
          <span className="font-mono">{slot.ports.rails}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">frontend</span>
          <span className="font-mono">{slot.ports.frontend}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">anycable</span>
          <span className="font-mono">{slot.ports.anycable}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">docker</span>
          <DockerBadge status={slot.docker.anycable} />
        </div>
      </div>
    </div>
  );
}

type Props = { cwd: string | null };

export function SlotMonitorIndicator({ cwd }: Props) {
  const { available, match, health, refresh } = useSlotMonitor(cwd);

  if (available === false || !match || !health) return null;

  const meta = HEALTH_META[health];
  const slot = match.slot;

  return (
    <Tooltip
      onOpenChange={(open) => {
        if (open) refresh();
      }}
    >
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Slot ${slot.slot} (${slot.status}): ${meta.label}. Open slot monitor.`}
        >
          <HugeiconsIcon
            icon={BulbIcon}
            size={14}
            strokeWidth={2}
            className={cn(meta.icon, meta.glow)}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        className="w-72 max-w-none flex-col items-stretch gap-0 rounded-xl border border-border bg-popover p-3 text-left text-popover-foreground shadow-xl"
      >
        <SlotDashboard slot={slot} health={health} />
      </TooltipContent>
    </Tooltip>
  );
}
