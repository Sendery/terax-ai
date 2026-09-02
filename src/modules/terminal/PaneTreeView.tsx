import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { paneDividerColor, type TabColor } from "@/modules/tabs";
import type { SearchAddon } from "@xterm/addon-search";
import { type CSSProperties, Fragment } from "react";
import { useTerminalDropStore } from "./lib/dropStore";
import { leafIds, type PaneNode } from "./lib/panes";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  blocks: boolean;
  onFocusLeaf: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
  onOpenFileLink: (path: string) => void;
  homePath?: string | null;
  /** Accent of the owning tab, so a split seam matches the tab it belongs to. */
  tabColor?: TabColor;
};

export function PaneTreeView(props: Props) {
  const { node } = props;
  if (node.kind === "leaf") {
    const { tabVisible, activeLeafId, blocks, onFocusLeaf, getBundle } = props;
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    return (
      <div
        onMouseDownCapture={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        // Catches focus from Tab, programmatic focus, or any path that
        // skips mousedown — keeps activeLeafId in sync with DOM focus.
        onFocus={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        data-pane-leaf={node.id}
        className="relative h-full w-full"
      >
        <TerminalPane
          leafId={node.id}
          visible={tabVisible}
          focused={focused}
          initialCwd={node.cwd}
          blocks={blocks}
          homePath={props.homePath}
          ref={b.setRef}
          onSearchReady={b.onSearchReady}
          onCwd={b.onCwd}
          onExit={b.onExit}
          onOpenFileLink={props.onOpenFileLink}
        />
        <DropOverlay leafId={node.id} />
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => (
        <Fragment key={leafIds(child)[0]}>
          {i > 0 && (
            <ResizableHandle
              className={cn(
                "w-0.5 bg-[var(--pane-divider)] opacity-65 transition-opacity duration-150",
                "hover:opacity-100 active:opacity-100 focus-visible:opacity-100",
                "aria-[orientation=horizontal]:h-0.5 aria-[orientation=horizontal]:w-full",
              )}
              style={
                {
                  "--pane-divider": paneDividerColor(props.tabColor),
                } as CSSProperties
              }
            />
          )}
          <ResizablePanel id={`pane-${child.id}`} minSize="10%">
            <PaneTreeView {...props} node={child} />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      Drop file path here
    </div>
  );
}
