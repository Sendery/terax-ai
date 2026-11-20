import { RenderableLayout } from "@/modules/renderable/RenderableLayout";
import { ViewModeToggle } from "@/modules/renderable/ViewModeToggle";
import { fileRenderKind, type ViewMode } from "@/modules/renderable/viewMode";
import { SourcePreview } from "@/modules/renderable/SourcePreview";
import { editorLocationOffset } from "@/modules/editor/lib/locationOffset";
import { getKey } from "@/modules/ai/lib/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import { redo, undo } from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { languageIdOf, useLspExtension } from "@/modules/lsp";
import { convertFileSrc } from "@tauri-apps/api/core";
import { inlineCompletion } from "./lib/autocomplete/inlineExtension";
import {
  buildSharedExtensions,
  languageCompartment,
  lspCompartment,
  vimCompartment,
  wrapCompartment,
} from "./lib/extensions";
import { resolveLanguage } from "./lib/languageResolver";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";
import { useDocument } from "./lib/useDocument";
import { initVimGlobals, vimHandlersExtension } from "./lib/vim";

const GraphJsonTools = lazy(() => import("@/modules/graphx/GraphJsonTools").then(m => ({ default: m.GraphJsonTools })));

initVimGlobals();

export type EditorPaneHandle = {
  setQuery: (q: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearQuery: () => void;
  focus: () => void;
  getSelection: () => string | null;
  /** The whole buffer, unsaved edits included; null when no editor is up. */
  getText: () => string | null;
  /** True when the source editor is on screen and accepts input. */
  isEditable: () => boolean;
  /** Replaces the selection (or inserts at the cursor), for Cut and Paste. */
  replaceSelection: (text: string) => void;
  getPath: () => string;
  /** Re-read the file from disk. Skips silently if the buffer is dirty. */
  reload: () => boolean;
  /** Move the cursor to a 1-based line and center it, once content is ready. */
  gotoLine: (line: number, column?: number) => void;
  /** Apply CodeMirror's undo/redo commands. */
  undo: () => void;
  redo: () => void;
};

type Props = {
  path: string;
  viewMode?: ViewMode;
  visible?: boolean;
  onSetView?: (mode: ViewMode) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose?: () => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const EditorPane = forwardRef<EditorPaneHandle, Props>(
  function EditorPane(
    { path, viewMode = "raw", visible = true, onSetView, onDirtyChange, onSaved, onClose },
    ref,
  ) {
    const { doc, dirty, onChange, save, reload } = useDocument({
      path,
      onDirtyChange,
    });
    const [saveError, setSaveError] = useState("");
    const saveDocument = () => {
      void save()
        .then(() => { setSaveError(""); onSaved?.(); })
        .catch(error => setSaveError(String(error)));
    };
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const presentation = useRef({ viewMode, visible, onSetView });
    presentation.current = { viewMode, visible, onSetView };
    const pendingFocus = useRef(false);
    const themeExt = useEditorThemeExt();
    const vimMode = usePreferencesStore((s) => s.vimMode);
    const editorWordWrap = usePreferencesStore((s) => s.editorWordWrap);
    const languageRef = useRef<string | null>(null);
    const apiKeyRef = useRef<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      const refresh = async () => {
        const provider = usePreferencesStore.getState().autocompleteProvider;
        if (
          provider === "lmstudio" ||
          provider === "mlx" ||
          provider === "ollama"
        ) {
          apiKeyRef.current = null;
          return;
        }
        const k = await getKey(provider);
        if (!cancelled) apiKeyRef.current = k;
      };
      void refresh();
      let unlistenKeys: (() => void) | undefined;
      void onKeysChanged(() => void refresh()).then((un) => {
        unlistenKeys = un;
      });
      const unsubPrefs = usePreferencesStore.subscribe((state, prev) => {
        if (state.autocompleteProvider !== prev.autocompleteProvider) {
          void refresh();
        }
      });
      return () => {
        cancelled = true;
        unlistenKeys?.();
        unsubPrefs();
      };
    }, []);
    // Stabilize save + onSaved via refs so the extensions array never changes
    // identity — a new identity makes @uiw/react-codemirror reconfigure the
    // whole state, wiping the language compartment.
    const saveRef = useRef(save);
    saveRef.current = save;
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const pathRef = useRef(path);
    pathRef.current = path;

    const pendingLineRef = useRef<{ line: number; column?: number } | null>(
      null,
    );
    const statusRef = useRef(doc.status);
    statusRef.current = doc.status;

    const applyPendingGoto = useCallback((createdView?: EditorView) => {
      const view = createdView ?? cmRef.current?.view;
      if (
        !view || statusRef.current !== "ready" ||
        !presentation.current.visible || presentation.current.viewMode === "rendered"
      ) return;
      if (pendingFocus.current) {
        pendingFocus.current = false;
        view.focus();
      }
      const line = pendingLineRef.current;
      if (line == null) return;
      const at = editorLocationOffset(view.state.doc, line.line, line.column);
      view.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, { y: "center" }),
      });
      view.focus();
      pendingLineRef.current = null;
    }, []);

    useEffect(() => {
      if (doc.status === "ready" && visible && viewMode !== "rendered") applyPendingGoto();
    }, [doc.status, visible, viewMode, applyPendingGoto]);

    const extensions = useMemo(
      () => [
        // basicSetup is added before user extensions by @uiw/react-codemirror,
        // so we must elevate vim's precedence to win the keymap.
        vimCompartment.of(
          usePreferencesStore.getState().vimMode ? Prec.highest(vim()) : [],
        ),
        wrapCompartment.of(
          usePreferencesStore.getState().editorWordWrap
            ? EditorView.lineWrapping
            : [],
        ),
        vimHandlersExtension(() => ({
          save: () => {
            void (async () => {
              await saveRef.current();
              onSavedRef.current?.();
            })();
          },
          close: () => onCloseRef.current?.(),
        })),
        ...buildSharedExtensions(),
        languageCompartment.of([]),
        lspCompartment.of([]),
        inlineCompletion({
          getPrefs: () => {
            const s = usePreferencesStore.getState();
            const p = s.autocompleteProvider;
            const modelId =
              p === "lmstudio"
                ? s.lmstudioModelId
                : p === "mlx"
                  ? s.mlxModelId
                  : p === "ollama"
                    ? s.ollamaModelId
                    : p === "openai-compatible"
                      ? s.openaiCompatibleModelId
                      : p === "openrouter"
                        ? s.openrouterModelId
                        : s.autocompleteModelId;
            return {
              enabled: s.autocompleteEnabled,
              provider: p,
              modelId,
              apiKey: apiKeyRef.current,
              lmstudioBaseURL: s.lmstudioBaseURL,
              mlxBaseURL: s.mlxBaseURL,
              ollamaBaseURL: s.ollamaBaseURL,
              openaiCompatibleBaseURL: s.openaiCompatibleBaseURL,
            };
          },
          getPath: () => pathRef.current,
          getLanguage: () => languageRef.current,
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void (async () => {
                await saveRef.current();
                onSavedRef.current?.();
              })();
              return true;
            },
          },
        ]),
      ],
      [],
    );

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: vimCompartment.reconfigure(vimMode ? Prec.highest(vim()) : []),
      });
    }, [vimMode]);

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: wrapCompartment.reconfigure(
          editorWordWrap ? EditorView.lineWrapping : [],
        ),
      });
    }, [editorWordWrap]);

    useEffect(() => {
      const ext = path.split(".").pop()?.toLowerCase() ?? null;
      languageRef.current = ext;
      if (doc.status !== "ready") return;
      let cancelled = false;
      const resolve = async (): Promise<Extension> => {
        if (path.toLowerCase().endsWith(".terax-theme")) {
          const [{ json }, { colorSwatches }] = await Promise.all([
            import("@codemirror/lang-json"),
            import("./lib/colorSwatches"),
          ]);
          return [json(), colorSwatches()];
        }
        return (await resolveLanguage(path)) ?? [];
      };
      void resolve().then((extension) => {
        if (cancelled) return;
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch({
          effects: languageCompartment.reconfigure(extension),
        });
      });
      return () => {
        cancelled = true;
      };
    }, [path, doc.status]);

    const langId = useMemo(() => languageIdOf(path), [path]);
    const lspExt = useLspExtension(path, langId, doc.status === "ready");
    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: lspCompartment.reconfigure(lspExt ?? []),
      });
    }, [lspExt]);

    useImperativeHandle(
      ref,
      () => ({
        setQuery: (q: string) => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(
              new SearchQuery({ search: q, caseSensitive: false }),
            ),
          });
          if (q) findNext(view);
        },
        findNext: () => {
          const view = cmRef.current?.view;
          if (view) findNext(view);
        },
        findPrevious: () => {
          const view = cmRef.current?.view;
          if (view) findPrevious(view);
        },
        clearQuery: () => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: "" })),
          });
        },
        focus: () => {
          pendingFocus.current = true;
          if (presentation.current.viewMode === "rendered") presentation.current.onSetView?.("raw");
          else applyPendingGoto();
        },
        getSelection: () => {
          const view = cmRef.current?.view;
          if (!view) return null;
          const { from, to } = view.state.selection.main;
          if (from === to) return null;
          return view.state.sliceDoc(from, to);
        },
        getText: () => {
          const view = cmRef.current?.view;
          return view ? view.state.doc.toString() : null;
        },
        isEditable: () =>
          presentation.current.viewMode !== "rendered" &&
          Boolean(cmRef.current?.view),
        replaceSelection: (text: string) => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch(view.state.replaceSelection(text));
          view.focus();
        },
        getPath: () => path,
        reload: () => reloadRef.current(),
        gotoLine: (line: number, column?: number) => {
          pendingLineRef.current = { line, column };
          if (presentation.current.viewMode === "rendered") presentation.current.onSetView?.("raw");
          applyPendingGoto();
        },
        undo: () => {
          const view = cmRef.current?.view;
          if (view) undo(view);
        },
        redo: () => {
          const view = cmRef.current?.view;
          if (view) redo(view);
        },
      }),
      [path, applyPendingGoto],
    );

    if (doc.status === "loading") {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      );
    }
    if (doc.status === "error") {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
          {doc.message}
        </div>
      );
    }
    if (doc.status === "binary" || doc.status === "toolarge") {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext);
      const isVideo = ["mp4", "webm", "ogg", "mov"].includes(ext);
      const isAudio = ["mp3", "wav", "flac", "aac", "m4a"].includes(ext);
      const isPdf = ext === "pdf";

      if (isImage || isVideo || isAudio || isPdf) {
        const assetUrl = convertFileSrc(path);
        return (
          <div className="flex h-full min-h-0 flex-col items-center justify-center bg-background p-4 overflow-auto">
            {isImage && (
              <img
                src={assetUrl}
                loading="lazy"
                decoding="async"
                className="max-w-full max-h-full object-contain rounded-md border border-border shadow-sm"
                style={{
                  backgroundImage: 'conic-gradient(#e5e7eb 0.25turn, #f3f4f6 0.25turn 0.5turn, #e5e7eb 0.5turn 0.75turn, #f3f4f6 0.75turn)',
                  backgroundSize: '20px 20px',
                }}
                alt={path.split('/').pop()}
              />
            )}
            {isVideo && (
              // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
              <video
                controls
                preload="metadata"
                className="max-w-full max-h-full"
                src={assetUrl}
              />
            )}
            {isAudio && (
              // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
              <audio
                controls
                preload="metadata"
                className="w-full max-w-md"
                src={assetUrl}
              />
            )}
            {isPdf && (
              <iframe
                src={assetUrl}
                className="w-full h-full border-none"
                title={path.split('/').pop()}
              />
            )}
          </div>
        );
      }

      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <div className="text-sm text-foreground">
            {doc.status === "binary" ? "Binary file" : "File too large"}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)} · preview not supported
          </div>
        </div>
      );
    }

    const raw = (
      <div className="flex h-full min-h-0 flex-col zoom-exempt">
        {fileRenderKind(path) === "graphx" && (
          <Suspense fallback={null}>
            <GraphJsonTools source={doc.content} getView={() => cmRef.current?.view} />
          </Suspense>
        )}
        <CodeMirror
          ref={cmRef}
          value={doc.content}
          onChange={(next, update) => onChange(next, {
            autoSave: !update.transactions.some(transaction => transaction.isUserEvent("input.format.graphx")),
          })}
          onCreateEditor={applyPendingGoto}
          theme={themeExt}
          extensions={extensions}
          height="100%"
          className="terax-code-editor flex-1 min-h-0 overflow-hidden"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            searchKeymap: true,
          }}
        />
      </div>
    );
    if (!fileRenderKind(path) || !onSetView) return raw;
    return (
      <section
        aria-label="File document"
        className="flex h-full min-h-0 flex-col"
        onKeyDown={event => {
          if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            saveDocument();
          }
        }}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-border/60 p-1.5">
          <span role="status" className="mr-auto text-[11px] text-muted-foreground">
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
          <button
            type="button"
            disabled={!dirty}
            onClick={saveDocument}
            className="rounded px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
          >
            Save
          </button>
          <ViewModeToggle mode={viewMode} onChange={onSetView} />
        </div>
        {saveError && <p role="alert" className="px-3 py-1 text-xs text-destructive">{saveError}</p>}
        <RenderableLayout
          mode={viewMode}
          raw={raw}
          rendered={visible && <SourcePreview source={doc.content} path={path} />}
        />
      </section>
    );
  },
);
