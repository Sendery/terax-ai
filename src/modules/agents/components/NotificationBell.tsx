import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Loading03Icon,
  Notification01Icon,
  Notification03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { TAB_COLOR_CSS, tabColorStyle } from "@/modules/tabs";
import { AgentIcon } from "../lib/agentIcon";
import { bellBadgeCount, bellRowView } from "../lib/bell";
import { claudeHooksFooter } from "../lib/hooksFooter";
import type { AgentNotification, AgentStatus } from "../lib/types";
import { useAgentStore } from "../store/agentStore";

type Props = {
  onActivate: (tabId: number, leafId: number) => void;
  onActivateLocal: () => void;
};

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusRow({
  agent,
  status,
  onClick,
}: {
  agent: string;
  status: AgentStatus;
  onClick: () => void;
}) {
  const waiting = status === "waiting";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      <AgentIcon
        agent={agent}
        size={16}
        className="shrink-0 text-muted-foreground"
      />
      <span className="flex-1 truncate text-sm text-foreground">{agent}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs",
          waiting ? "font-medium text-primary" : "text-muted-foreground",
        )}
      >
        {waiting ? <span className="size-1.5 rounded-full bg-primary" /> : null}
        {waiting ? "waiting" : "working"}
      </span>
    </button>
  );
}

export function NotificationRow({
  n,
  onClick,
  onDismiss,
}: {
  n: AgentNotification;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const view = bellRowView(n);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 pr-7 text-left transition-colors hover:bg-accent",
          !n.read && "bg-accent/40",
        )}
      >
        {/* The agent's logo with the tab's colour, as on the native notification. */}
        <span className="relative mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <AgentIcon
            agent={n.agent}
            size={16}
            className="text-muted-foreground"
          />
          {n.tabColor ? (
            <span
              className="absolute -right-1 -bottom-1 size-2 rounded-full ring-2 ring-popover"
              style={{ backgroundColor: TAB_COLOR_CSS[n.tabColor] }}
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[12px] leading-none">
              {view.mark}
            </span>
            <span
              className={cn(
                "truncate text-sm text-foreground",
                !n.read && "font-medium",
              )}
            >
              {view.name}{" "}
              <span className="font-normal text-muted-foreground">
                {view.label}
              </span>
            </span>
          </span>
          {view.detail ? (
            <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {view.detail}
            </span>
          ) : null}
          {view.where || n.tabTitle ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
              {n.tabTitle ? (
                <span
                  className="inline-flex max-w-[120px] items-center rounded border px-1 text-[9.5px] leading-[14px]"
                  style={
                    n.tabColor
                      ? tabColorStyle(n.tabColor, false)
                      : { borderColor: "var(--border)" }
                  }
                  title={`in ${n.tabTitle}`}
                >
                  <span className="truncate">{n.tabTitle}</span>
                </span>
              ) : null}
              {view.where ? (
                <span className="truncate">{view.where}</span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {relativeTime(n.at)}
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss notification"
        className="absolute top-7 right-1.5 hidden rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground group-hover:block"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function NotificationBell({ onActivate, onActivateLocal }: Props) {
  const [open, setOpen] = useState(false);
  const [hooksReady, setHooksReady] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  const sessions = useAgentStore((s) => s.sessions);
  const localAgent = useAgentStore((s) => s.localAgent);
  const notifications = useAgentStore((s) => s.notifications);
  const markRead = useAgentStore((s) => s.markRead);
  const markAllRead = useAgentStore((s) => s.markAllRead);
  const dismissNotification = useAgentStore((s) => s.dismissNotification);
  const clearNotifications = useAgentStore((s) => s.clearNotifications);

  const active = useMemo(() => Object.values(sessions), [sessions]);
  const activeCount = active.length + (localAgent ? 1 : 0);
  const badge = bellBadgeCount(notifications);

  const refreshHooks = () => {
    invoke<boolean>("agent_claude_hooks_status")
      .then(setHooksReady)
      .catch(() => setHooksReady(null));
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) refreshHooks();
  };

  const enableClaudeHooks = async () => {
    setInstalling(true);
    setInstallFailed(false);
    try {
      await invoke("agent_enable_claude_hooks");
      setHooksReady(true);
    } catch {
      setHooksReady(false);
      setInstallFailed(true);
    } finally {
      setInstalling(false);
    }
  };

  const footer = claudeHooksFooter({
    installed: hooksReady,
    installing,
    failed: installFailed,
  });

  const activate = (tabId: number, leafId: number) => {
    onActivate(tabId, leafId);
    setOpen(false);
  };

  const activateLocal = () => {
    onActivateLocal();
    setOpen(false);
  };

  const activateNotification = (n: AgentNotification) => {
    markRead(n.id);
    if (n.source === "local") activateLocal();
    else activate(n.tabId, n.leafId);
  };

  const empty = activeCount === 0 && notifications.length === 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Agent notifications"
        >
          <HugeiconsIcon
            icon={Notification01Icon}
            size={16}
            strokeWidth={1.75}
          />
          {badge > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold leading-none text-primary-foreground">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 overflow-hidden p-0 gap-0.5"
      >
        <div className="flex h-10 items-center px-3 pt-0.5">
          <span className="flex gap-1 text-[13px] text-foreground">
            Notifications
          </span>
          {activeCount > 0 ? (
            <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {activeCount} active
            </span>
          ) : null}
          {notifications.length > 0 ? (
            <span className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={markAllRead}
                disabled={badge === 0}
                title="Mark all as read"
                aria-label="Mark all as read"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={clearNotifications}
                title="Clear notifications"
                aria-label="Clear notifications"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={Delete02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
              </button>
            </span>
          ) : null}
        </div>

        {empty ? (
          <div className="border-t border-border/60 px-3 py-5 text-center text-xs leading-relaxed text-muted-foreground">
            No agent activity yet.
            <br />
            Run the Terax agent or Claude Code to track it here.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto border-t border-border/60 p-1">
            {localAgent ? (
              <StatusRow
                agent={localAgent.agent}
                status={localAgent.status}
                onClick={activateLocal}
              />
            ) : null}
            {active.map((s) => (
              <StatusRow
                key={s.leafId}
                agent={s.agent}
                status={s.status}
                onClick={() => activate(s.tabId, s.leafId)}
              />
            ))}
            {activeCount > 0 && notifications.length > 0 ? (
              <div className="mx-2 my-1 h-px bg-border/50" />
            ) : null}
            {notifications.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onClick={() => activateNotification(n)}
                onDismiss={() => dismissNotification(n.id)}
              />
            ))}
          </div>
        )}

        <div className="border-t flex justify-center border-border/60 p-1">
          {footer.kind === "ready" ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                size={13}
                strokeWidth={1.75}
                className="text-primary"
              />
              Claude Code alerts enabled
            </div>
          ) : (
            <button
              type="button"
              onClick={enableClaudeHooks}
              disabled={installing}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
            >
              <HugeiconsIcon
                icon={installing ? Loading03Icon : Notification03Icon}
                size={14}
                strokeWidth={1.75}
                className={cn(installing && "animate-spin")}
              />
              {installing ? "Enabling..." : "Enable Claude Code alerts"}
            </button>
          )}
          {footer.error ? (
            <p className="px-2 pt-1 text-[11px] text-destructive">
              Could not update Claude Code config.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
