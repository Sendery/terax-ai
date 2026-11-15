import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/modules/ai/store/chatStore";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Clock01Icon,
  CommandLineIcon,
  ComputerTerminal02Icon,
  Copy01Icon,
  MoreHorizontalIcon,
  Refresh01Icon,
  Search01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PositionedBlock, VisibleBlocks } from "./lib/blockDecorations";
import { capAttachOutput } from "./lib/outputCap";
import {
  BlockSearchController,
  readAvailableBlockOutput,
  type Awaitable,
  type BlockUiMatch,
  type BlockReveal,
  type BlockSearchState,
} from "./lib/blockSearchController";
import { writeDeferredTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";

let cachedHome: string | null = null;
void homeDir()
  .then((h) => {
    cachedHome = h.replace(/\/+$/, "");
  })
  .catch(() => {});

type Props = {
  subscribe: (cb: () => void) => () => void;
  getVisible: () => VisibleBlocks;
  readOutput: (id: string) => Awaitable<string | null>;
  searchBlock: (id: string, query: string) => Awaitable<BlockUiMatch[]>;
  revealMatch: BlockReveal;
  clearSearch: () => Awaitable<void>;
  promptReady: boolean;
  onRunAgain: (command: string) => Awaitable<void>;
  actionOwner?: unknown;
  active?: boolean;
  available?: () => boolean;
  privateTerminal?: boolean;
  onRestoreFocus: () => void;
};

const EMPTY: VisibleBlocks = { blocks: [], sticky: null };

function fmtDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60000);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function relPath(p: string): string {
  if (cachedHome && (p === cachedHome || p.startsWith(`${cachedHome}/`))) {
    return `~${p.slice(cachedHome.length)}`;
  }
  return p;
}

function copy(
  read: () => Promise<string>,
  message: string,
  current: () => boolean,
) {
  void writeDeferredTerminalClipboard(read, current)
    .then(() => {
      if (current()) toast.success(message);
    })
    .catch((error: unknown) => {
      if (current())
        toast.error(
          error instanceof Error &&
            error.message.includes("no longer available")
            ? "Block output is no longer available."
            : "Could not copy block.",
        );
    });
}

function signature(v: VisibleBlocks): string {
  return JSON.stringify(v);
}
type OverlayActions = Props & {
  current: () => boolean;
  canAttach: () => boolean;
};
export function BlockOverlay(props: Props) {
  const { subscribe, getVisible } = props;
  const [vis, setVis] = useState<VisibleBlocks>(EMPTY);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [searchFocus, setSearchFocus] = useState(0);
  const openSearch = (id: string) => {
    setSearchId(id);
    setSearchFocus((value) => value + 1);
  };
  const lastSig = useRef("");
  const mounted = useRef(true);
  const returnFocus = useRef<(() => boolean) | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const owner = props.actionOwner ?? props.getVisible;
  const current = () =>
    mounted.current &&
    (latest.current.actionOwner ?? latest.current.getVisible) === owner &&
    (latest.current.active ?? true) &&
    (latest.current.available?.() ?? true);
  const actions: OverlayActions = {
    ...props,
    current,
    canAttach: () => current() && !latest.current.privateTerminal,
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (props.active === false) setSearchId(null);
  }, [props.active]);

  useEffect(() => {
    lastSig.current = "";
    const update = () => {
      const v = getVisible();
      const sig = signature(v);
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      setVis(v);
    };
    update();
    return subscribe(update);
  }, [subscribe, getVisible]);

  const closeSearch = () => {
    returnFocus.current = current;
    setSearchId(null);
  };
  useEffect(() => {
    if (searchId !== null) return;
    const valid = returnFocus.current;
    returnFocus.current = null;
    if (valid?.()) latest.current.onRestoreFocus();
  }, [searchId]);

  return (
    <div
      data-native-block-overlay=""
      data-terax-capture-foreground=""
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {vis.blocks.map((b) => (
        <BlockChrome key={b.id} block={b} all={actions} onSearch={openSearch} />
      ))}
      {vis.sticky && (
        <StickyHeader block={vis.sticky} all={actions} onSearch={openSearch} />
      )}
      {searchId && props.active !== false && (
        <SearchBar
          key={searchId}
          blockId={searchId}
          focusRequest={searchFocus}
          current={current}
          searchBlock={props.searchBlock}
          revealMatch={props.revealMatch}
          clearSearch={props.clearSearch}
          onClose={closeSearch}
        />
      )}
    </div>
  );
}

/** Read-only capture chrome from one immutable native block projection. */
export function BlockOverlaySnapshot({
  visible,
  promptReady = false,
}: {
  visible: VisibleBlocks;
  promptReady?: boolean;
}) {
  const noAction = () => {};
  const actions: OverlayActions = {
    subscribe: () => noAction,
    getVisible: () => visible,
    readOutput: () => null,
    searchBlock: () => [],
    revealMatch: () => false,
    clearSearch: noAction,
    promptReady,
    onRunAgain: noAction,
    onRestoreFocus: noAction,
    privateTerminal: true,
    active: false,
    current: () => false,
    canAttach: () => false,
  };
  return (
    <div
      inert
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {visible.blocks.map((block) => (
        <BlockChrome
          key={block.id}
          block={block}
          all={actions}
          onSearch={noAction}
        />
      ))}
      {visible.sticky && (
        <StickyHeader
          block={visible.sticky}
          all={actions}
          onSearch={noAction}
        />
      )}
    </div>
  );
}

type ChromeProps = {
  block: PositionedBlock;
  all: OverlayActions;
  onSearch: (id: string) => void;
};

// No chrome while the command runs; the bar lands together with the divider
// once the block is finished.
function BlockChrome({ block, all, onSearch }: ChromeProps) {
  if (block.running) return null;
  return (
    <>
      <div
        className={cn("bt-divider", !block.ok && "bt-divider-fail")}
        style={{ top: block.bottom }}
      />
      {block.headerTop !== null && (
        <div className="bt-bar" style={{ top: block.headerTop }}>
          <Meta block={block} />
          <Toolbar block={block} all={all} onSearch={onSearch} />
        </div>
      )}
    </>
  );
}

function Meta({ block }: { block: PositionedBlock }) {
  return (
    <span className="bt-head-meta">
      {block.cwd && <span className="bt-cwd">{relPath(block.cwd)}</span>}
      <span className="bt-clock">
        <HugeiconsIcon icon={Clock01Icon} size={11} strokeWidth={1.75} />
        {fmtTime(block.startedAt)}
      </span>
    </span>
  );
}

function StickyHeader({ block, all, onSearch }: ChromeProps) {
  return (
    <div className="bt-sticky">
      <HugeiconsIcon
        className="bt-sticky-icon"
        icon={CommandLineIcon}
        size={12}
        strokeWidth={1.75}
      />
      <span className="bt-sticky-cmd">{block.command || "command"}</span>
      <Toolbar block={block} all={all} onSearch={onSearch} />
    </div>
  );
}

function Toolbar({ block, all, onSearch }: ChromeProps) {
  const duration = block.running
    ? null
    : fmtDuration(block.finishedAt - block.startedAt);
  const failed = !block.running && !block.ok && block.exitCode !== null;
  return (
    <div className="bt-tools">
      {failed && <span className="bt-exit">exit {block.exitCode}</span>}
      {duration && <span className="bt-dur">{duration}</span>}
      {!block.running && !!block.command && (
        <button
          type="button"
          title="Run again"
          className="bt-btn"
          disabled={!all.promptReady}
          onClick={() => {
            if (all.current() && all.promptReady)
              void Promise.resolve(all.onRunAgain(block.command)).catch(() =>
                toast.error("Could not run command."),
              );
          }}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={12.5} strokeWidth={1.75} />
        </button>
      )}
      <BlockMenu block={block} all={all} onSearch={onSearch} />
    </div>
  );
}

function BlockMenu({ block, all, onSearch }: ChromeProps) {
  const openingSearch = useRef(false);
  const output = (current = all.current) =>
    readAvailableBlockOutput(all.readOutput, block.id, current);
  const attach = () => {
    void output(all.canAttach)
      .then((value) => {
        if (!all.canAttach()) return;
        const out = capAttachOutput(value);
        const text = out ? `$ ${block.command}\n${out}` : `$ ${block.command}`;
        useChatStore.getState().attachSelection(text, "terminal");
      })
      .catch(() => {
        if (all.canAttach())
          toast.error("Block output is no longer available.");
      });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="Block actions" className="bt-btn">
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            size={14}
            strokeWidth={1.75}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (openingSearch.current) {
            if (all.current()) onSearch(block.id);
          } else if (all.current()) all.onRestoreFocus();
          openingSearch.current = false;
        }}
      >
        <MenuItem
          icon={Refresh01Icon}
          label="Run again"
          disabled={block.running || !all.promptReady || !block.command}
          onClick={() => {
            if (all.current() && all.promptReady)
              void Promise.resolve(all.onRunAgain(block.command)).catch(() =>
                toast.error("Could not run command."),
              );
          }}
        />
        <MenuItem
          icon={Copy01Icon}
          label="Copy command"
          disabled={!block.command}
          onClick={() =>
            copy(async () => block.command, "Command copied", all.current)
          }
        />
        <MenuItem
          icon={ComputerTerminal02Icon}
          label="Copy output"
          disabled={block.running}
          onClick={() => copy(() => output(), "Output copied", all.current)}
        />
        <MenuItem
          icon={Copy01Icon}
          label="Copy command and output"
          disabled={block.running}
          onClick={() =>
            copy(
              async () => `$ ${block.command}\n${await output()}`,
              "Block copied",
              all.current,
            )
          }
        />
        {!all.privateTerminal && (
          <MenuItem
            icon={SparklesIcon}
            label="Attach to AI chat"
            disabled={block.running}
            onClick={attach}
          />
        )}
        <MenuItem
          icon={Search01Icon}
          label="Find in block"
          disabled={block.running}
          onClick={() => {
            if (all.current()) openingSearch.current = true;
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuItem({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof Copy01Icon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onClick}
      className="gap-2 text-xs"
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
      {label}
    </DropdownMenuItem>
  );
}

// One fixed search bar pinned to the top of the terminal so it stays put while
// navigating matches (the grid scrolls underneath).
function SearchBar({
  blockId,
  focusRequest,
  searchBlock,
  revealMatch,
  clearSearch,
  current,
  onClose,
}: {
  blockId: string;
  focusRequest: number;
  searchBlock: Props["searchBlock"];
  revealMatch: Props["revealMatch"];
  clearSearch: Props["clearSearch"];
  current: () => boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<BlockSearchState>({
    matches: [],
    index: 0,
    pending: false,
    error: null,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<number | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const controller = useMemo(() => {
    const model = new BlockSearchController({
      searchBlock: (query) => {
        if (!currentRef.current())
          throw new Error("Block output is no longer available.");
        return searchBlock(blockId, query);
      },
      revealMatch: async (match) => {
        if (!currentRef.current()) return false;
        return (await revealMatch(match)) !== false;
      },
      clearSearch,
      onChange: () => setState(model.state),
    });
    return model;
  }, [blockId, searchBlock, revealMatch, clearSearch]);
  useEffect(() => {
    setState(controller.state);
    return () => {
      void controller.dispose().catch(() => {});
    };
  }, [controller]);
  useEffect(() => {
    if (lastFocus.current === focusRequest) return;
    lastFocus.current = focusRequest;
    inputRef.current?.focus();
  }, [focusRequest]);
  const nav = (direction: -1 | 1) => {
    void controller.navigate(direction);
  };
  const { matches, index: idx, pending, error } = state;
  return (
    <div className="bt-search pointer-events-auto">
      <HugeiconsIcon icon={Search01Icon} size={12} strokeWidth={1.75} />
      <input
        ref={inputRef}
        className="bt-search-input"
        placeholder="Find in block"
        aria-label="Find in block"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => controller.find(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            nav(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="bt-search-count" role="status" aria-live="polite">
        {pending ? "…" : matches.length ? `${idx + 1}/${matches.length}` : "0"}
      </span>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <SearchBtn
        title="Previous"
        disabled={pending || !matches.length}
        icon={ArrowUp01Icon}
        onClick={() => nav(-1)}
      />
      <SearchBtn
        title="Next"
        disabled={pending || !matches.length}
        icon={ArrowDown01Icon}
        onClick={() => nav(1)}
      />
      <SearchBtn title="Close" icon={Cancel01Icon} onClick={onClose} />
    </div>
  );
}

function SearchBtn({
  title,
  icon,
  onClick,
  disabled,
}: {
  title: string;
  disabled?: boolean;
  icon: typeof Copy01Icon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="bt-btn"
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.75} />
    </button>
  );
}
