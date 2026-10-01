import { Spinner } from "@/components/ui/spinner";
import {
  buildSharedExtensions,
  languageCompartment,
} from "@/modules/editor/lib/extensions";
import {
  resolveLanguage,
  resolveLanguageSync,
} from "@/modules/editor/lib/languageResolver";
import { useEditorThemeExt } from "@/modules/editor/lib/useEditorThemeExt";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";

import { diffViewConfig, type DiffViewPrefs } from "./lib/diffView";

/** Beyond this a merge view stops being useful and starts being slow. */
const LARGE_FILE_THRESHOLD = 256 * 1024;

const SHARED_EXT = buildSharedExtensions();
const READONLY_EXT = [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

export type PrReviewDiffProps = {
  path: string;
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
  prefs: DiffViewPrefs;
  themeExt: Extension;
};

/**
 * One file, rendered the way the reviewer asked for.
 *
 * Both arrangements come from `@codemirror/merge`, which needs a whole new view
 * when the layout changes, so the view is rebuilt rather than reconfigured.
 * Binary and very large files fall back to the patch text: a merge view over
 * either is unreadable at best.
 */
export function PrReviewDiff({
  path,
  originalContent,
  modifiedContent,
  isBinary,
  fallbackPatch,
  prefs,
  themeExt,
}: PrReviewDiffProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [lang, setLang] = useState<Extension | null>(
    () => resolveLanguageSync(path) ?? null,
  );

  const tooLarge =
    originalContent.length > LARGE_FILE_THRESHOLD ||
    modifiedContent.length > LARGE_FILE_THRESHOLD;
  const useFallback = isBinary || tooLarge;

  useEffect(() => {
    if (useFallback) return;
    if (resolveLanguageSync(path)) {
      setLang(resolveLanguageSync(path) ?? null);
      return;
    }
    let cancelled = false;
    void resolveLanguage(path).then((ext) => {
      if (!cancelled) setLang(ext ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [path, useFallback]);

  const config = useMemo(() => diffViewConfig(prefs), [prefs]);

  useEffect(() => {
    if (useFallback) return;
    const host = hostRef.current;
    if (!host) return;

    const base: Extension[] = [
      ...SHARED_EXT,
      languageCompartment.of(lang ?? []),
      ...READONLY_EXT,
      themeExt,
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
      }),
    ];

    if (config.split) {
      const view = new MergeView({
        a: { doc: originalContent, extensions: base },
        b: { doc: modifiedContent, extensions: base },
        parent: host,
        revertControls: undefined,
        highlightChanges: config.highlightChanges,
        gutter: true,
        collapseUnchanged: config.collapseUnchanged,
      });
      return () => view.destroy();
    }

    const view = new EditorView({
      doc: modifiedContent,
      parent: host,
      extensions: [
        ...base,
        unifiedMergeView({
          original: originalContent,
          mergeControls: false,
          highlightChanges: config.highlightChanges,
          gutter: true,
          syntaxHighlightDeletions: config.syntaxHighlightDeletions,
          collapseUnchanged: config.collapseUnchanged,
        }),
      ],
    });
    return () => view.destroy();
  }, [originalContent, modifiedContent, config, lang, themeExt, useFallback]);

  if (isBinary) {
    return (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        Binary file, not shown.
      </p>
    );
  }
  if (tooLarge) {
    return (
      <pre className="h-full overflow-auto whitespace-pre p-3 font-mono text-[11px] leading-relaxed">
        {fallbackPatch || "File too large to diff."}
      </pre>
    );
  }
  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />;
}

export function PrReviewDiffLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
      <Spinner className="size-3" />
      Loading diff…
    </div>
  );
}

export function usePrReviewThemeExt() {
  return useEditorThemeExt();
}
