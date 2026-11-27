import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { LinkedTabContext } from "@/modules/tabs/LinkedTabPane";
import { type LinkedTabs, MAX_SPLIT_PERCENT, MIN_SPLIT_PERCENT } from "@/modules/tabs/lib/linkedTabs";
import { graphDockMargins } from "@/modules/graphx/lib/presentation";
import { GraphPanels } from "@/modules/graphx";
import type { GraphPanelProps } from "@/modules/graphx/GraphPanels";
import { cn } from "@/lib/utils";
import { AiDiffStack, EditorStack, GitDiffStack } from "@/modules/editor";
import { GitHistoryStack } from "@/modules/git-history";
import { MermaidStack } from "@/modules/mermaid";
import { PrReviewStack } from "@/modules/pr-review";
import { PreviewStack } from "@/modules/preview";
import { ReaderDock, ReaderStack } from "@/modules/reader";
import {
  ReadContextMenu,
  type ReadContextMenuBinding,
} from "@/modules/reader/components/ReadContextMenu";
import type { Tab } from "@/modules/tabs";
import { TerminalStack } from "@/modules/terminal";
import { lazy, Suspense, type ComponentProps, type CSSProperties, useMemo, useState } from "react";

const AgentFlow = lazy(() => import("@/modules/agent-flow/AgentFlow"));

type TerminalStackProps = ComponentProps<typeof TerminalStack>;
type EditorStackProps = ComponentProps<typeof EditorStack>;
type PreviewStackProps = ComponentProps<typeof PreviewStack>;
type MermaidStackProps = ComponentProps<typeof MermaidStack>;
type AiDiffStackProps = ComponentProps<typeof AiDiffStack>;
type GitHistoryStackProps = ComponentProps<typeof GitHistoryStack>;
type ReaderDockProps = ComponentProps<typeof ReaderDock>;

/** The Reader panel docked under the active tab, as App drives it. */
export type ReaderDockBinding = {
  onResize: (tabId: number, height: number) => void;
  onClose: (tabId: number) => void;
  onPick: (
    tabId: number,
    entry: Parameters<ReaderDockProps["onPick"]>[0],
  ) => void;
  onDeleted: ReaderDockProps["onDeleted"];
  onOpenAsTab: ReaderDockProps["onOpenAsTab"];
  onEscape: (tabId: number) => void;
  originTab: ReaderDockProps["originTab"];
  /** A Reader tab's "Dock here": back into the panel of its origin tab. */
  onDockHere: (tabId: number, docId: string) => void;
};

type Props = {
  onGraphUpdate: GraphPanelProps["onUpdate"];
  onGraphPlace: GraphPanelProps["onPlace"];
  onGraphPanel: GraphPanelProps["onPanel"];
  tabs: Tab[];
  activeId: number;
  activeTab: Tab | undefined;
  tabPair?: LinkedTabs;
  onActivateTab: (tabId: number) => void;
  onResizeTabPair: (key: string, percent: number) => void;
  registerTerminalHandle: TerminalStackProps["registerHandle"];
  onSearchReady: TerminalStackProps["onSearchReady"];
  onCwd: TerminalStackProps["onCwd"];
  onExit: TerminalStackProps["onExit"];
  onFocusLeaf: TerminalStackProps["onFocusLeaf"];
  onOpenFileLink: TerminalStackProps["onOpenFileLink"];
  onReadAloud: TerminalStackProps["onReadAloud"];
  onStopReading: TerminalStackProps["onStopReading"];
  selectionActions: TerminalStackProps["selectionActions"];
  homePath?: TerminalStackProps["homePath"];
  registerEditorHandle: EditorStackProps["registerHandle"];
  onEditorDirtyChange: EditorStackProps["onDirtyChange"];
  onEditorCloseTab: EditorStackProps["onCloseTab"];
  registerPreviewHandle: PreviewStackProps["registerHandle"];
  onPreviewUrlChange: PreviewStackProps["onUrlChange"];
  onAiDiffAccept: AiDiffStackProps["onAccept"];
  onAiDiffReject: AiDiffStackProps["onReject"];
  onOpenCommitFile: GitHistoryStackProps["onOpenCommitFile"];
  onPrReviewBaseChange: (tabId: number, base: string) => void;
  onReaderClose: (tabId: number) => void;
  onReaderTitle: (tabId: number, title: string) => void;
  readerDock: ReaderDockBinding;
  /** Right-click in the editor and Markdown views: clipboard and reading. */
  editorReadMenu: ReadContextMenuBinding;
  onGitHistorySearchHandle: GitHistoryStackProps["onSearchHandle"];
  onSetRenderableView: EditorStackProps["onSetRenderableView"];
  onMermaidSourceChange: MermaidStackProps["onSourceChange"];
  onMermaidVisualLayoutChange: MermaidStackProps["onVisualLayoutChange"];
  onActivateAgent: (tabId: number, leafId: number) => void;
  onAgentFlowDetached: (tabId: number) => void;
};

/**
 * Stacks every tab-kind surface absolutely on top of each other and toggles
 * visibility off the active tab, so panes keep their mounted state (terminal
 * buffers, editor scroll, ...) when switching tabs.
 */
export function WorkspaceSurface({
  onGraphUpdate,
  onGraphPlace,
  onGraphPanel,
  tabs,
  activeId,
  activeTab,
  tabPair,
  onActivateTab,
  onResizeTabPair,
  registerTerminalHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
  onOpenFileLink,
  onReadAloud,
  onStopReading,
  selectionActions,
  homePath,
  registerEditorHandle,
  onEditorDirtyChange,
  onEditorCloseTab,
  registerPreviewHandle,
  onPreviewUrlChange,
  onAiDiffAccept,
  onAiDiffReject,
  onOpenCommitFile,
  onPrReviewBaseChange,
  onReaderClose,
  onReaderTitle,
  readerDock,
  editorReadMenu,
  onGitHistorySearchHandle,
  onSetRenderableView,
  onMermaidSourceChange,
  onMermaidVisualLayoutChange,
  onActivateAgent,
  onAgentFlowDetached,
}: Props) {
  const kind = activeTab?.kind;
  const agentFlowTab = tabs.find((tab) => tab.kind === "agent-flow");
  const partner = tabPair && tabs.find((tab) =>
    tab.id === (activeId === tabPair.leftId ? tabPair.rightId : tabPair.leftId));
  const isTerminalTab = kind === "terminal" || partner?.kind === "terminal";
  const isEditorTab = kind === "editor" || kind === "markdown" ||
    partner?.kind === "editor" || partner?.kind === "markdown";
  const isPreviewTab = kind === "preview" || partner?.kind === "preview";
  const linkedContext = useMemo(() => tabPair ? { link: tabPair, activate: onActivateTab } : null,
    [tabPair, onActivateTab]);
  const isMermaidTab = kind === "mermaid";
  const isAiDiffTab = kind === "ai-diff";
  const isGitDiffTab = kind === "git-diff" || kind === "git-commit-file";
  const isGitHistoryTab = kind === "git-history";
  const isPrReviewTab = kind === "pr-review";
  const isReaderTab = kind === "reader";
  const readerMenu: ReadContextMenuBinding = {
    ...editorReadMenu,
    readSelection: () => window.getSelection()?.toString() ?? null,
    blockedReason: () => null,
    documentFallback: () => false,
    editable: () => false,
  };

  const dock =
    activeTab && activeTab.kind !== "reader" ? activeTab.readerDock : undefined;
  const dockTabId = activeTab?.id ?? -1;

  const workspace = (
    <div className="relative h-full min-h-0">
      <div
        className="relative flex h-full min-h-0 flex-col"
        style={graphDockMargins(tabs, activeTab)}
      >
        <div
          className="relative min-h-0 flex-1"
          style={tabPair ? ({ "--tab-split-position": `${tabPair.percent}%` } as CSSProperties) : undefined}
        >
          <div
            className={cn(
              "absolute inset-0 px-3 pt-2 pb-2",
              tabPair && "pointer-events-none",
              !isTerminalTab && "invisible pointer-events-none",
            )}
            aria-hidden={!isTerminalTab}
          >
            <TerminalStack
              tabs={tabs}
              activeId={activeId}
              registerHandle={registerTerminalHandle}
              onSearchReady={onSearchReady}
              onCwd={onCwd}
              onExit={onExit}
              onFocusLeaf={onFocusLeaf}
              onOpenFileLink={onOpenFileLink}
              onReadAloud={onReadAloud}
              onStopReading={onStopReading}
              selectionActions={selectionActions}
              homePath={homePath}
            />
          </div>
          <ReadContextMenu binding={editorReadMenu}>
            <div
              className={cn(
                "absolute inset-0 px-3 pt-2 pb-2",
                tabPair && "pointer-events-none",
                !isEditorTab && "invisible pointer-events-none",
              )}
              aria-hidden={!isEditorTab}
            >
              <EditorStack
                tabs={tabs}
                activeId={activeId}
                registerHandle={registerEditorHandle}
                onDirtyChange={onEditorDirtyChange}
                onCloseTab={onEditorCloseTab}
                onSetRenderableView={onSetRenderableView}
              />
            </div>
          </ReadContextMenu>
          <div
            className={cn(
              "absolute inset-0 px-3 pt-2 pb-2",
              tabPair && "pointer-events-none",
              !isPreviewTab && "invisible pointer-events-none",
            )}
            aria-hidden={!isPreviewTab}
          >
            <PreviewStack
              tabs={tabs}
              activeId={activeId}
              registerHandle={registerPreviewHandle}
              onUrlChange={onPreviewUrlChange}
            />
          </div>
          <div
            className={cn(
              "absolute inset-0 px-3 pt-2 pb-2",
              !isMermaidTab && "invisible pointer-events-none",
            )}
            aria-hidden={!isMermaidTab}
          >
            <MermaidStack
              tabs={tabs.filter((tab) => tab.kind === "mermaid")}
              activeId={activeId}
              onSourceChange={onMermaidSourceChange}
              onVisualLayoutChange={onMermaidVisualLayoutChange}
              onSetView={onSetRenderableView}
            />
          </div>
          <div
            className={cn(
              "absolute inset-0 px-3 pt-2 pb-2",
              !isAiDiffTab && "invisible pointer-events-none",
            )}
            aria-hidden={!isAiDiffTab}
          >
            <AiDiffStack
              tabs={tabs}
              activeId={activeId}
              onAccept={onAiDiffAccept}
              onReject={onAiDiffReject}
            />
          </div>
          <div
            className={cn(
              "absolute inset-0 px-3 pt-2 pb-2",
              !isGitDiffTab && "invisible pointer-events-none",
            )}
            aria-hidden={!isGitDiffTab}
          >
            <GitDiffStack tabs={tabs} activeId={activeId} />
          </div>
          <div
            className={cn(
              "absolute inset-0",
              !isGitHistoryTab && "invisible pointer-events-none",
            )}
            aria-hidden={!isGitHistoryTab}
          >
            <GitHistoryStack
              tabs={tabs}
              activeId={activeId}
              onOpenCommitFile={onOpenCommitFile}
              onSearchHandle={onGitHistorySearchHandle}
            />
          </div>
          <div
            className={cn(
              "absolute inset-0 px-3 pt-2 pb-2",
              !isPrReviewTab && "invisible pointer-events-none",
            )}
            aria-hidden={!isPrReviewTab}
          >
            <PrReviewStack
              tabs={tabs}
              activeId={activeId}
              onBaseChange={onPrReviewBaseChange}
            />
          </div>
          <div
            className={cn(
              "absolute inset-0",
              !isReaderTab && "invisible pointer-events-none",
            )}
            aria-hidden={!isReaderTab}
          >
            <ReaderStack
              tabs={tabs}
              activeId={activeId}
              onClose={onReaderClose}
              onTitle={onReaderTitle}
              readMenu={readerMenu}
              binding={{
                onPick: readerDock.onPick,
                onDeleted: readerDock.onDeleted,
                originTab: readerDock.originTab,
                onDockHere: readerDock.onDockHere,
              }}
            />
          </div>
          {agentFlowTab ? (
            <div className={cn("absolute inset-0", kind !== "agent-flow" && "hidden")}>
              <Suspense fallback={<p className="p-4 text-xs text-muted-foreground">Loading Agent Flow…</p>}>
                <AgentFlow
                  key={agentFlowTab.id}
                  tabs={tabs}
                  open={kind === "agent-flow"}
                  onActivate={onActivateAgent}
                  onDetached={() => onAgentFlowDetached(agentFlowTab.id)}
                />
              </Suspense>
            </div>
          ) : null}
          {tabPair ? (
            <LinkedTabDivider
              key={tabPair.key}
              pair={tabPair}
              onResize={onResizeTabPair}
            />
          ) : null}
        </div>
        {dock ? (
          <ReaderDock
            key={dockTabId}
            docId={dock.docId}
            readMenu={readerMenu}
            height={dock.height}
            onResize={(h) => readerDock.onResize(dockTabId, h)}
            onClose={() => readerDock.onClose(dockTabId)}
            onPick={(entry) => readerDock.onPick(dockTabId, entry)}
            onDeleted={readerDock.onDeleted}
            onOpenAsTab={readerDock.onOpenAsTab}
            onEscape={() => readerDock.onEscape(dockTabId)}
            originTab={readerDock.originTab}
          />
        ) : null}
      </div>
      <GraphPanels
        tabs={tabs}
        activeId={activeId}
        activeTab={activeTab}
        onUpdate={onGraphUpdate}
        onPlace={onGraphPlace}
        onPanel={onGraphPanel}
        onSetView={onSetRenderableView}
      />
    </div>
  );
  return <LinkedTabContext.Provider value={linkedContext}>{workspace}</LinkedTabContext.Provider>;
}

function LinkedTabDivider({ pair, onResize }: {
  pair: LinkedTabs;
  onResize: Props["onResizeTabPair"];
}) {
  // Changing the default while dragging re-registers the panels and interrupts the gesture.
  const [defaultLayout] = useState(() => ({
    "linked-left": pair.percent,
    "linked-right": 100 - pair.percent,
  }));
  return (
    <div className="pointer-events-none absolute inset-x-3 inset-y-2 z-10">
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChange={(layout) => onResize(pair.key, layout["linked-left"])}
      >
        <ResizablePanel id="linked-left" minSize={`${MIN_SPLIT_PERCENT}%`} maxSize={`${MAX_SPLIT_PERCENT}%`} />
        <ResizableHandle withHandle aria-label="Resize linked tabs" className="pointer-events-auto" />
        <ResizablePanel id="linked-right" minSize={`${MIN_SPLIT_PERCENT}%`} />
      </ResizablePanelGroup>
    </div>
  );
}
