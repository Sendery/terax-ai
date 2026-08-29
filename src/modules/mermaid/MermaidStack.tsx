import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useEditorThemeExt } from "@/modules/editor/lib/useEditorThemeExt";
import type { MermaidTab } from "@/modules/tabs";
import { useTheme } from "@/modules/theme";
import CodeMirror from "@uiw/react-codemirror";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  renderMermaidSource,
  svgToDataUrl,
  validateMermaidSourceWithRuntime,
} from "./lib/render";
import { createLatestMermaidRenderer } from "./lib/renderQueue";
import {
  canLivePreviewMermaidSource,
  MAX_MERMAID_LIVE_PREVIEW_BYTES,
  MAX_MERMAID_SOURCE_BYTES,
  mermaidSourceByteLength,
  validateMermaidSource,
} from "./lib/source";
import { selectMountedMermaidTabs } from "./lib/visibility";
import { MermaidVisualEditorLazy } from "./MermaidVisualEditorLazy";

type MermaidPaneProps = {
  active: boolean;
  tab: MermaidTab;
  onSourceChange: (tabId: number, source: string) => void;
  onVisualLayoutChange: (
    tabId: number,
    layout: MermaidTab["visualLayout"],
  ) => void;
};

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/^Error:\s*/i, "")
      .trim()
      .slice(0, 600) || "Mermaid could not render this diagram"
  );
}

function MermaidPane({
  active,
  tab,
  onSourceChange,
  onVisualLayoutChange,
}: MermaidPaneProps) {
  const editorTheme = useEditorThemeExt();
  const { resolvedMode } = useTheme();
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [draftSource, setDraftSource] = useState(tab.source);
  const draftSourceRef = useRef(tab.source);
  const committedSourceRef = useRef(tab.source);
  const [useLightweightEditor, setUseLightweightEditor] = useState(
    () => !canLivePreviewMermaidSource(tab.source),
  );
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<"source" | "visual">("source");
  const svgUrl = useMemo(() => (svg ? svgToDataUrl(svg) : ""), [svg]);
  const livePreviewEnabled = useMemo(
    () => canLivePreviewMermaidSource(draftSource),
    [draftSource],
  );

  useEffect(() => {
    committedSourceRef.current = tab.source;
    if (tab.source !== draftSourceRef.current) {
      draftSourceRef.current = tab.source;
      setDraftSource(tab.source);
    }
  }, [tab.source]);

  useEffect(() => {
    if (draftSource === tab.source) return;
    const timer = window.setTimeout(() => {
      onSourceChange(tab.id, draftSource);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [draftSource, onSourceChange, tab.id, tab.source]);

  useEffect(
    () => () => {
      if (draftSourceRef.current !== committedSourceRef.current) {
        onSourceChange(tab.id, draftSourceRef.current);
      }
    },
    [onSourceChange, tab.id],
  );

  const renderer = useMemo(
    () =>
      createLatestMermaidRenderer({
        render: async (source) => {
          const imported = await import("mermaid");
          const runtime = imported.default;
          const renderId = `terax-mermaid-${tab.id}-${reactId}-${Date.now()}`;
          try {
            return await renderMermaidSource(
              runtime,
              source,
              renderId,
              resolvedMode,
            );
          } finally {
            document.getElementById(`d${renderId}`)?.remove();
          }
        },
        onSuccess: (nextSvg) => {
          setSvg(nextSvg);
          setError(null);
          setPending(false);
        },
        onError: (nextError) => {
          setError(errorMessage(nextError));
          setPending(false);
        },
      }),
    [reactId, resolvedMode, tab.id],
  );

  useEffect(() => {
    renderer.invalidate();
    setPending(true);
    const validation = validateMermaidSource(draftSource);
    if (!validation.ok) {
      setError(validation.message);
      setPending(false);
      return () => renderer.invalidate();
    }
    if (!canLivePreviewMermaidSource(validation.source)) {
      setError(null);
      setPending(false);
      return () => renderer.invalidate();
    }
    if (!active) {
      setPending(false);
      return () => renderer.invalidate();
    }
    const timer = window.setTimeout(() => {
      void renderer.run(validation.source);
    }, 350);
    return () => {
      window.clearTimeout(timer);
      renderer.invalidate();
    };
  }, [active, draftSource, renderer]);

  const updateSource = (source: string) => {
    if (mermaidSourceByteLength(source) > MAX_MERMAID_SOURCE_BYTES) {
      setError(
        `Mermaid source exceeds ${MAX_MERMAID_SOURCE_BYTES} UTF-8 bytes`,
      );
      return;
    }
    draftSourceRef.current = source;
    setDraftSource(source);
  };

  const commitDraft = () => {
    if (draftSourceRef.current !== committedSourceRef.current) {
      onSourceChange(tab.id, draftSourceRef.current);
    }
    if (!canLivePreviewMermaidSource(draftSourceRef.current)) {
      setUseLightweightEditor(true);
    }
  };

  const validateGeneratedSource = useCallback(
    async (source: string) => {
      const imported = await import("mermaid");
      await validateMermaidSourceWithRuntime(
        imported.default,
        source,
        resolvedMode,
      );
    },
    [resolvedMode],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-mermaid-editor
      data-mermaid-tab-id={tab.id}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-3 text-xs">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-medium">Mermaid</span>
            <span className="truncate text-muted-foreground">{tab.title}</span>
          </div>
          <fieldset
            className="m-0 flex shrink-0 rounded-md border-0 bg-muted/50 p-0.5"
            aria-label="Mermaid editor mode"
          >
            {(["source", "visual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                  mode === option
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option}
              </button>
            ))}
          </fieldset>
        </div>
        <fieldset
          className="m-0 flex items-center gap-1 border-0 p-0"
          aria-label="Diagram zoom controls"
        >
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-accent"
            onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="min-w-12 rounded px-1 py-1 text-muted-foreground hover:bg-accent"
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-accent"
            onClick={() => setZoom((value) => Math.min(3, value + 0.1))}
            aria-label="Zoom in"
          >
            +
          </button>
        </fieldset>
      </div>

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={42} minSize={25}>
          <section
            className="h-full min-h-0 border-r border-border/50 zoom-exempt"
            aria-label="Mermaid source editor"
          >
            {mode === "visual" ? (
              <MermaidVisualEditorLazy
                source={draftSource}
                visualLayout={tab.visualLayout}
                onSourceChange={updateSource}
                onVisualLayoutChange={(layout) =>
                  onVisualLayoutChange(tab.id, layout)
                }
                validateGeneratedSource={validateGeneratedSource}
              />
            ) : useLightweightEditor ? (
              <textarea
                aria-label="Large Mermaid source"
                className="h-full w-full resize-none bg-background p-3 font-mono text-xs text-foreground outline-none"
                onBlur={commitDraft}
                onChange={(event) => updateSource(event.currentTarget.value)}
                placeholder="flowchart LR\n  A --> B"
                spellCheck={false}
                value={draftSource}
              />
            ) : (
              <CodeMirror
                value={draftSource}
                onBlur={commitDraft}
                onChange={updateSource}
                theme={editorTheme}
                height="100%"
                className="h-full min-h-0 overflow-hidden"
                placeholder="flowchart LR\n  A --> B"
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLineGutter: true,
                  foldGutter: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  autocompletion: false,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  searchKeymap: true,
                }}
              />
            )}
          </section>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={58} minSize={25}>
          <section
            className="relative flex h-full min-h-0 flex-col bg-muted/15"
            aria-label="Mermaid diagram preview"
          >
            <div
              className="flex h-7 shrink-0 items-center gap-2 border-b border-border/50 px-3 text-[11px] text-muted-foreground"
              aria-live="polite"
            >
              {pending
                ? "Rendering…"
                : error
                  ? svg
                    ? "Preview from last valid source"
                    : "Render failed"
                  : !livePreviewEnabled
                    ? svg
                      ? `Live preview paused above ${MAX_MERMAID_LIVE_PREVIEW_BYTES / 1024} KiB: showing last rendered source`
                      : `Live preview paused above ${MAX_MERMAID_LIVE_PREVIEW_BYTES / 1024} KiB`
                    : "Preview up to date"}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-6">
              {svg ? (
                <img
                  alt="Rendered Mermaid diagram"
                  className="mx-auto block h-auto max-w-none origin-top-left"
                  style={{ transform: `scale(${zoom})` }}
                  src={svgUrl}
                />
              ) : !livePreviewEnabled && !error ? (
                <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
                  Live preview is paused for large sources to keep the editor
                  responsive.
                </div>
              ) : pending ? (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  Rendering diagram…
                </div>
              ) : null}
              {!svg && error ? (
                <div className="mx-auto mt-8 max-w-xl rounded-md border border-destructive/40 bg-destructive/5 p-4 font-mono text-xs text-destructive">
                  {error}
                </div>
              ) : null}
            </div>
            {error && svg ? (
              <div className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
                {error}
              </div>
            ) : null}
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

type MermaidStackProps = {
  tabs: MermaidTab[];
  activeId: number | null;
  onSourceChange: (tabId: number, source: string) => void;
  onVisualLayoutChange: (
    tabId: number,
    layout: MermaidTab["visualLayout"],
  ) => void;
};

export function MermaidStack({
  tabs,
  activeId,
  onSourceChange,
  onVisualLayoutChange,
}: MermaidStackProps) {
  const mermaids = selectMountedMermaidTabs(tabs, activeId);
  if (mermaids.length === 0) return null;
  return (
    <>
      {mermaids.map((tab) => (
        <div
          key={tab.id}
          className="h-full"
          data-capture-target="pane"
          data-capture-tab-id={tab.id}
        >
          <MermaidPane
            active={tab.id === activeId}
            tab={tab}
            onSourceChange={onSourceChange}
            onVisualLayoutChange={onVisualLayoutChange}
          />
        </div>
      ))}
    </>
  );
}
