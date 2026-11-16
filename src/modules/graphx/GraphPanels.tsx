import { registerFrameCaptureProvider } from "@/modules/capture/lib/frameCapture";
import {
  graphRenderReceipt,
  requestGraphCapture,
} from "@/modules/graphx/lib/frameCapture";
import {
  type GraphPlacement,
  parseGraphSource,
} from "@/modules/graphx/lib/document";
import { visibleGraph } from "@/modules/graphx/lib/presentation";
import type { GraphTab, Tab } from "@/modules/tabs";
import { useTheme } from "@/modules/theme";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useRef, useState } from "react";

export type GraphPanelProps = {
  tabs: Tab[];
  activeId: number;
  activeTab: Tab | undefined;
  onUpdate: (
    graphId: string,
    documentId: string,
    revision: number,
    source: string,
  ) => GraphTab;
  onPlace: (graphId: string, placement: GraphPlacement) => GraphTab;
  onPanel: (graphId: string, panel: GraphTab["panel"]) => void;
};

function GraphFrame({ tab }: { tab: GraphTab }) {
  const { resolvedMode } = useTheme();
  return (
    <GraphFrameSession
      key={`${tab.documentId}:${tab.revision}:${resolvedMode}`}
      tab={tab}
      theme={resolvedMode}
    />
  );
}
function GraphFrameSession({ tab, theme }: { tab: GraphTab; theme: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const token = useRef(crypto.randomUUID()).current;
  const [ready, setReady] = useState(false);
  const [state, setState] = useState("Loading GraphX...");
  const [receipt, setReceipt] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(
      () =>
        setState(
          "GraphX is taking longer than expected. Reopen this tab if it does not finish.",
        ),
      15000,
    );
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.token !== token
      )
        return;
      if (event.data.type === "terax:graphx:ready") setReady(true);
      if (
        event.data.revision !== tab.revision ||
        event.data.documentId !== tab.documentId
      )
        return;
      if (event.data.type === "terax:graphx:rendered") {
        const geometry = graphRenderReceipt(event.data.receipt);
        if (!geometry) return;
        window.clearTimeout(timeout);
        setState("");
        setReceipt(
          `GraphX rendered revision ${tab.revision}: ${geometry.nodes} nodes, ${geometry.paths} paths, ${geometry.width} by ${geometry.height} pixels.`,
        );
      }
      if (event.data.type === "terax:graphx:error") {
        window.clearTimeout(timeout);
        setState(
          event.data.reason === "styles"
            ? "GraphX styles are unavailable. Reopen this tab."
            : "Layout failed. Edit the JSON and apply again.",
        );
      }
    };
    window.addEventListener("message", receive);
    frame.current?.contentWindow?.postMessage(
      { type: "terax:graphx:hello", token },
      "*",
    );
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [token, tab.revision, tab.documentId]);
  useEffect(() => {
    const current = frame.current;
    if (!current) return;
    return registerFrameCaptureProvider(current, (scope) =>
      requestGraphCapture(
        current,
        { token, documentId: tab.documentId, revision: tab.revision },
        scope,
      ),
    );
  }, [token, tab.documentId, tab.revision]);
  useEffect(() => {
    if (!ready) return;
    setState("Laying out graph...");
    frame.current?.contentWindow?.postMessage(
      {
        type: "terax:graphx:render",
        token,
        spec: parseGraphSource(tab.source),
        revision: tab.revision,
        documentId: tab.documentId,
        theme,
      },
      "*",
    );
  }, [ready, tab.source, tab.revision, tab.documentId, token, theme]);
  return (
    <div className="relative min-h-0 flex-1">
      <iframe
        ref={frame}
        data-terax-capture-frame=""
        title={`${tab.title} interactive graph`}
        sandbox="allow-scripts"
        onLoad={() =>
          frame.current?.contentWindow?.postMessage(
            { type: "terax:graphx:hello", token },
            "*",
          )
        }
        referrerPolicy="no-referrer"
        src={`/graphx/index.html#${token}`}
        className="h-full w-full border-0"
      />
      <span role="status" className="sr-only">
        {receipt}
      </span>
      {state && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/95 px-3 py-1 text-xs"
        >
          {state}
        </div>
      )}
    </div>
  );
}

function GraphPanel({
  tab,
  visible,
  full,
  onUpdate,
  onPlace,
  onPanel,
}: {
  tab: GraphTab;
  visible: boolean;
  full: boolean;
  onUpdate: GraphPanelProps["onUpdate"];
  onPlace: GraphPanelProps["onPlace"];
  onPanel: GraphPanelProps["onPanel"];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.source);
  const [baseRevision, setBaseRevision] = useState(tab.revision);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<GraphTab["panel"]>();
  const container = useRef<HTMLElement>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelDrag.current?.(), []);

  const panel = drag ?? tab.panel ?? { x: 40, y: 40, width: 560, height: 440 };
  const floating = !full && tab.placement === "floating";
  const reload = () => {
    setDraft(tab.source);
    setBaseRevision(tab.revision);
    setError("");
  };
  const move = (
    event: React.PointerEvent<HTMLButtonElement>,
    resize = false,
  ) => {
    if (event.button !== 0) return;
    cancelDrag.current?.();
    const root = container.current?.parentElement?.getBoundingClientRect();
    if (!root) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX,
      startY = event.clientY;
    const initial = {
      ...panel,
      width: Math.min(panel.width, root.width),
      height: Math.min(panel.height, root.height),
    };
    if (!resize) onPlace(tab.graphId, "floating");
    let current = initial;
    const button = event.currentTarget;
    const onMove = (e: PointerEvent) => {
      current = resize
        ? {
            ...initial,
            width: Math.max(
              280,
              Math.min(root.width, initial.width + e.clientX - startX),
            ),
            height: Math.max(
              220,
              Math.min(root.height, initial.height + e.clientY - startY),
            ),
          }
        : {
            ...initial,
            x: Math.max(
              0,
              Math.min(
                root.width - initial.width,
                initial.x + e.clientX - startX,
              ),
            ),
            y: Math.max(
              0,
              Math.min(root.height - 80, initial.y + e.clientY - startY),
            ),
          };
      setDrag(current);
    };
    const finish = (e: PointerEvent) => {
      cancelDrag.current?.();
      onPanel(tab.graphId, current);
      setDrag(undefined);
      if (!resize && e.type === "pointerup") {
        if (e.clientX - root.left < 70) onPlace(tab.graphId, "left");
        else if (root.right - e.clientX < 70) onPlace(tab.graphId, "right");
      }
    };
    const cancel = (e: PointerEvent) => finish(e);
    cancelDrag.current = () => {
      button.removeEventListener("pointermove", onMove);
      button.removeEventListener("pointerup", finish);
      button.removeEventListener("pointercancel", cancel);
      cancelDrag.current = null;
    };
    button.addEventListener("pointermove", onMove);
    button.addEventListener("pointerup", finish);
    button.addEventListener("pointercancel", cancel);
  };
  const width = `min(${panel.width}px, 60%)`;
  const position = full
    ? { inset: 0 }
    : floating
      ? {
          left: `clamp(0px, ${panel.x}px, max(0px, 100% - ${panel.width}px))`,
          top: `clamp(0px, ${panel.y}px, max(0px, 100% - 100px))`,
          width: `min(${panel.width}px, 100%)`,
          height: `min(${panel.height}px, 100%)`,
        }
      : tab.placement === "left"
        ? { left: 0, top: 0, bottom: 0, width }
        : { right: 0, top: 0, bottom: 0, width };
  return (
    <section
      ref={container}
      aria-label={`${tab.title} GraphX panel`}
      data-capture-target="pane"
      data-graphx-panel=""
      data-terax-capture-foreground=""
      data-capture-tab-id={tab.id}
      className={`absolute flex min-h-0 flex-col overflow-hidden border border-border bg-background ${floating ? "z-30 rounded-lg shadow-xl" : "z-10"} ${visible ? "" : "invisible pointer-events-none"}`}
      style={position}
      aria-hidden={!visible}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1 text-xs">
        <button
          type="button"
          className="cursor-move rounded px-2 py-1 hover:bg-accent"
          aria-label="Drag GraphX panel; use placement selector for keyboard docking"
          onPointerDown={(e) => move(e)}
        >
          Move
        </button>
        <span className="min-w-12 flex-1 truncate font-medium">
          {tab.customTitle ?? tab.title}
        </span>
        <select
          aria-label="GraphX panel placement"
          className="rounded border border-border bg-background p-1"
          value={tab.placement}
          onChange={(e) =>
            onPlace(tab.graphId, e.target.value as GraphPlacement)
          }
        >
          <option value="tab">Tab</option>
          <option value="left">Dock left</option>
          <option value="right">Dock right</option>
          <option value="floating">Float</option>
        </select>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-accent"
          aria-pressed={editing}
          onClick={() => {
            if (!editing) reload();
            setEditing(!editing);
          }}
        >
          JSON
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-accent"
          onClick={() =>
            void writeText(tab.source).catch(() =>
              setError("Could not copy JSON"),
            )
          }
        >
          Copy JSON
        </button>
      </div>
      {editing && (
        <div className="flex h-60 shrink-0 flex-col border-b border-border p-2">
          <textarea
            aria-label="GraphX JSON source"
            className="min-h-0 flex-1 resize-none rounded border border-border bg-background p-2 font-mono text-xs"
            value={draft}
            maxLength={49152}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="mt-1 flex items-center gap-2 text-xs">
            <button
              type="button"
              className="rounded bg-primary px-2 py-1 text-primary-foreground"
              onClick={() => {
                try {
                  const next = onUpdate(
                    tab.graphId,
                    tab.documentId,
                    baseRevision,
                    draft,
                  );
                  setBaseRevision(next.revision);
                  setError("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Update failed");
                }
              }}
            >
              Apply JSON
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 hover:bg-accent"
              onClick={reload}
            >
              Reload current
            </button>
            <label className="cursor-pointer rounded px-2 py-1 hover:bg-accent">
              Import JSON
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (file.size > 49152) {
                    setError("GraphX JSON is limited to 48 KiB");
                    return;
                  }
                  try {
                    const source = await file.text();
                    parseGraphSource(source);
                    setDraft(source);
                    setError("");
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Import failed",
                    );
                  }
                }}
              />
            </label>
            <span className="ml-auto text-muted-foreground">
              Saved revision {tab.revision}
            </span>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="shrink-0 px-3 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
      {visible && <GraphFrame tab={tab} />}
      {!full && (
        <button
          type="button"
          aria-label="Resize GraphX panel"
          title="Drag to resize; arrow keys adjust panel size"
          className="absolute bottom-0 right-0 z-20 h-5 w-5 cursor-se-resize rounded-tl border border-border bg-background text-xs"
          onPointerDown={(e) => move(e, true)}
          onKeyDown={(e) => {
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            onPanel(tab.graphId, {
              ...panel,
              width: Math.max(
                280,
                Math.min(
                  1600,
                  panel.width +
                    (e.key === "ArrowLeft"
                      ? -20
                      : e.key === "ArrowRight"
                        ? 20
                        : 0),
                ),
              ),
              height: Math.max(
                220,
                Math.min(
                  1000,
                  panel.height +
                    (e.key === "ArrowUp"
                      ? -20
                      : e.key === "ArrowDown"
                        ? 20
                        : 0),
                ),
              ),
            });
          }}
        >
          ↘
        </button>
      )}
    </section>
  );
}

export function GraphPanels({
  tabs,
  activeTab,
  onUpdate,
  onPlace,
  onPanel,
}: GraphPanelProps) {
  const current = visibleGraph(tabs, activeTab);
  return (
    <>
      {tabs
        .filter((t): t is GraphTab => t.kind === "graphx")
        .map((tab) => (
          <GraphPanel
            key={tab.id}
            tab={tab}
            visible={current?.id === tab.id}
            full={activeTab?.kind === "graphx"}
            onUpdate={onUpdate}
            onPlace={onPlace}
            onPanel={onPanel}
          />
        ))}
    </>
  );
}
