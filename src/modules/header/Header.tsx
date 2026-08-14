import { Button } from "@/components/ui/button";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { NotificationBell } from "@/modules/agents";
import { type Tab, TabBar, type TabColor } from "@/modules/tabs";
import {
  AlarmClockIcon,
  CommandIcon,
  GitBranchIcon,
  Note01Icon,
  Settings01Icon,
  SidebarLeftIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SearchInline,
  type SearchInlineHandle,
  type SearchTarget,
} from "./SearchInline";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onClose: (id: number) => void;
  /** Promote a preview (transient) tab to persistent. */
  onPin: (id: number) => void;
  /** Set a tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  /** Set or reset a tab's palette color. null clears the color. */
  onSetColor: (id: number, color: TabColor | null) => void;
  /** Move a dragged tab to a new position (insertion gap index). */
  onReorder: (fromId: number, toGapIndex: number) => void;
  onToggleSidebar: () => void;
  onToggleNotes: () => void;
  notesVisible: boolean;
  onToggleTasks: () => void;
  tasksVisible: boolean;
  onToggleAgentMonitor: () => void;
  agentMonitorVisible: boolean;
  onToggleSessionGraph: () => void;
  sessionGraphVisible: boolean;
  /** Agent whose transcript the panel would show, null when none is readable. */
  sessionGraphAgent: string | null;
  /** Number of enabled scheduled tasks, shown as a badge on the toggle. */
  scheduledCount: number;
  /** True while the global scheduler kill switch is engaged. */
  scheduledPaused: boolean;
  onOpenCommandPalette: () => void;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  onOpenSettings: () => void;
  spaceSwitcher: ReactNode;
  searchTarget: SearchTarget;
  searchRef: RefObject<SearchInlineHandle | null>;
};

const COMPACT_WIDTH = 720;

export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onClose,
  onPin,
  onRename,
  onSetColor,
  onReorder,
  onToggleSidebar,
  onToggleNotes,
  notesVisible,
  onToggleTasks,
  tasksVisible,
  onToggleAgentMonitor,
  agentMonitorVisible,
  onToggleSessionGraph,
  sessionGraphVisible,
  sessionGraphAgent,
  scheduledCount,
  scheduledPaused,
  onOpenCommandPalette,
  onActivateAgent,
  onActivateLocalAgent,
  onOpenSettings,
  spaceSwitcher,
  searchTarget,
  searchRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w < COMPACT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const settingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onOpenSettings}
      title="Settings"
    >
      <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
    </Button>
  );

  const notesButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle notes panel"
      aria-pressed={notesVisible}
      className={`size-7 shrink-0 rounded-md hover:bg-accent hover:text-foreground ${
        notesVisible
          ? "bg-accent/60 text-foreground"
          : "text-muted-foreground"
      }`}
      onClick={onToggleNotes}
      title="Toggle notes"
    >
      <HugeiconsIcon icon={Note01Icon} size={15} strokeWidth={1.75} />
    </Button>
  );

  const agentMonitorButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle agent monitor panel"
      aria-pressed={agentMonitorVisible}
      className={`size-7 shrink-0 rounded-md hover:bg-accent hover:text-foreground ${
        agentMonitorVisible
          ? "bg-accent/60 text-foreground"
          : "text-muted-foreground"
      }`}
      onClick={onToggleAgentMonitor}
      title="Toggle agent monitor"
    >
      <HugeiconsIcon icon={TerminalIcon} size={15} strokeWidth={1.75} />
    </Button>
  );

  const tasksButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={
        scheduledCount > 0
          ? `Toggle scheduled tasks panel, ${scheduledCount} scheduled${
              scheduledPaused ? ", all paused" : ""
            }`
          : "Toggle scheduled tasks panel"
      }
      aria-pressed={tasksVisible}
      className={`relative size-7 shrink-0 rounded-md hover:bg-accent hover:text-foreground ${
        tasksVisible ? "bg-accent/60 text-foreground" : "text-muted-foreground"
      }`}
      onClick={onToggleTasks}
      title="Toggle scheduled tasks"
    >
      <HugeiconsIcon icon={AlarmClockIcon} size={15} strokeWidth={1.75} />
      {scheduledCount > 0 && (
        <span
          aria-hidden
          className={`absolute top-0.5 right-0.5 size-1.5 rounded-full ${
            scheduledPaused ? "bg-amber-500" : "bg-emerald-500"
          }`}
        />
      )}
    </Button>
  );

  const sessionGraphButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={
        sessionGraphAgent
          ? `Toggle session history panel for ${sessionGraphAgent}`
          : "Toggle session history panel"
      }
      aria-pressed={sessionGraphVisible}
      className={`relative size-7 shrink-0 rounded-md hover:bg-accent hover:text-foreground ${
        sessionGraphVisible ? "bg-accent/60 text-foreground" : "text-muted-foreground"
      }`}
      onClick={onToggleSessionGraph}
      title="Toggle session history"
    >
      <HugeiconsIcon icon={GitBranchIcon} size={15} strokeWidth={1.75} />
      {sessionGraphAgent && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-sky-500"
        />
      )}
    </Button>
  );

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      data-capture-target="header"
      className={`flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
        IS_MAC ? "pr-2 pl-20" : "pr-0 pl-2"
      }`}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={SidebarLeftIcon} size={18} strokeWidth={1.75} />
        </Button>

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onOpenCommandPalette}
          title="Command palette"
          className="shrink-0 gap-1.5 rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={CommandIcon} size={14} strokeWidth={1.75} />
        </Button>

        {!IS_MAC && (
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
        )}
      </div>

      {!IS_MAC && <span className="mx-1 h-full w-px shrink-0 bg-border/70" />}

      {IS_MAC && <span className="mr-1 h-full w-px shrink-0 bg-border/70" />}

      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        data-tauri-drag-region
      >
        {spaceSwitcher}
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={onSelect}
          onNew={onNew}
          onNewBlock={onNewBlock}
          onNewPrivate={onNewPrivate}
          onNewPreview={onNewPreview}
          onNewEditor={onNewEditor}
          onNewGitGraph={onNewGitGraph}
          onClose={onClose}
          onPin={onPin}
          onRename={onRename}
          onSetColor={onSetColor}
          onReorder={onReorder}
          compact={compact}
        />
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      <SearchInline ref={searchRef} target={searchTarget} compact={compact} />

      {IS_MAC && (
        <>
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
          {sessionGraphButton}
          {tasksButton}
          {agentMonitorButton}
          {notesButton}
          {settingsButton}
        </>
      )}

      {!IS_MAC && (
        <>
          {sessionGraphButton}
          {tasksButton}
          {agentMonitorButton}
          {notesButton}
          {settingsButton}
        </>
      )}

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border/60" />
          <WindowControls />
        </>
      )}
    </div>
  );
}
