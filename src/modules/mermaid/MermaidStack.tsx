import { RenderableLayout } from "@/modules/renderable/RenderableLayout";
import { ViewModeToggle } from "@/modules/renderable/ViewModeToggle";
import { resolveViewMode, type ViewMode } from "@/modules/renderable/viewMode";
import { useEditorThemeExt } from "@/modules/editor/lib/useEditorThemeExt";
import { MermaidPreview } from "@/modules/graphx/MermaidPreview";
import type { MermaidTab } from "@/modules/tabs";
import { useTheme } from "@/modules/theme";
import CodeMirror from "@uiw/react-codemirror";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { validateMermaidSourceWithRuntime } from "./lib/render";
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
  onSetView: (id: number, mode: ViewMode) => void;
  tab: MermaidTab;
  onSourceChange: (tabId: number, source: string) => void;
  onVisualLayoutChange: (
    tabId: number,
    layout: MermaidTab["visualLayout"],
  ) => void;
};

function MermaidPane({
  active,
  tab,
  onSourceChange,
  onVisualLayoutChange,
  onSetView,
}: MermaidPaneProps) {
  const editorTheme = useEditorThemeExt();
  const viewMode = resolveViewMode(tab);
  const { resolvedMode } = useTheme();
  const [draftSource, setDraftSource] = useState(tab.source);
  const draftSourceRef = useRef(tab.source);
  const committedSourceRef = useRef(tab.source);
  const [useLightweightEditor, setUseLightweightEditor] = useState(
    () => !canLivePreviewMermaidSource(tab.source),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [mode, setMode] = useState<"preview" | "visual">("preview");
  const [graphSource, setGraphSource] = useState("");
  const livePreviewEnabled = canLivePreviewMermaidSource(draftSource);

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

  useEffect(() => {
    const validation = validateMermaidSource(draftSource);
    if (!validation.ok) {
      setError(validation.message);
      setPending(false);
      return;
    }
    setError(null);
    if (!active || viewMode === "raw" || mode === "visual" ||
        !canLivePreviewMermaidSource(validation.source)) {
      setPending(false);
      return;
    }
    setPending(true);
    const timer = window.setTimeout(() => {
      setGraphSource(validation.source);
      setPending(false);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [active, draftSource, viewMode, mode]);

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

  const raw = (
    <section
      className="h-full min-h-0 border-r border-border/50 zoom-exempt"
      aria-label="Mermaid source editor"
    >
      {useLightweightEditor ? (
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
  );
  const preview = (
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
            ? graphSource
              ? "Preview from last valid source"
              : "Render failed"
            : !livePreviewEnabled
              ? graphSource
                ? `Live preview paused above ${MAX_MERMAID_LIVE_PREVIEW_BYTES / 1024} KiB: showing last rendered source`
                : `Live preview paused above ${MAX_MERMAID_LIVE_PREVIEW_BYTES / 1024} KiB`
              : "Preview"}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {active && graphSource ? (
          <MermaidPreview
            source={graphSource}
            title={tab.title}
            fallback={<pre className="whitespace-pre-wrap">{graphSource}</pre>}
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
        {!graphSource && error ? (
          <div className="mx-auto mt-8 max-w-xl rounded-md border border-destructive/40 bg-destructive/5 p-4 font-mono text-xs text-destructive">
            {error}
          </div>
        ) : null}
      </div>
      {error && graphSource ? (
        <div className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
          {error}
        </div>
      ) : null}
    </section>
  );
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
      data-mermaid-editor
      data-mermaid-tab-id={tab.id}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-1 text-xs">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-medium">Mermaid</span>
            <span className="truncate text-muted-foreground">{tab.title}</span>
          </div>
          <fieldset
            className="m-0 flex shrink-0 rounded-md border-0 bg-muted/50 p-0.5"
            aria-label="Mermaid rendered tools"
          >
            {(["preview", "visual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => { setMode(option); if (viewMode === "raw") onSetView(tab.id, "side-by-side"); }}
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
        <ViewModeToggle mode={viewMode} onChange={(next) => onSetView(tab.id, next)} />
      </div>

      <RenderableLayout
        mode={viewMode}
        raw={raw}
        rendered={mode === "visual" ? (
          <MermaidVisualEditorLazy
            source={draftSource}
            visualLayout={tab.visualLayout}
            onSourceChange={updateSource}
            onVisualLayoutChange={(layout) => onVisualLayoutChange(tab.id, layout)}
            validateGeneratedSource={validateGeneratedSource}
          />
        ) : preview}
      />
    </div>
  );
}

type MermaidStackProps = {
  tabs: MermaidTab[];
  activeId: number | null;
  onSetView: (id: number, mode: ViewMode) => void;
  onSourceChange: (tabId: number, source: string) => void;
  onVisualLayoutChange: (
    tabId: number,
    layout: MermaidTab["visualLayout"],
  ) => void;
};

export function MermaidStack({
  tabs,
  activeId,
  onSetView,
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
            onSetView={onSetView}
            tab={tab}
            onSourceChange={onSourceChange}
            onVisualLayoutChange={onVisualLayoutChange}
          />
        </div>
      ))}
    </>
  );
}
