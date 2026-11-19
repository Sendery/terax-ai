import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { nextBlockWord } from "@/modules/reader/lib/document";
import {
  READER_KEY_HELP,
  readerKeyAction,
  type ReaderAction,
} from "@/modules/reader/lib/keys";
import {
  adjacentCut,
  allCuts,
  stepSpeed,
  type CutPoint,
} from "@/modules/reader/lib/manifest";
import {
  loadStored,
  moveCursorTo,
  playReader,
  setReaderSpeed,
  skipReader,
  stepReader,
  toggleReader,
  toggleReaderCut,
} from "@/modules/reader/lib/player";
import { useReaderStore } from "@/modules/reader/store/readerStore";
import { exportWithToast } from "@/modules/reader/lib/exportToast";
import type { ExportSplit } from "@/modules/reader/lib/flow";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ReaderText } from "./ReaderText";
import { ReaderTransport } from "./ReaderTransport";

type Props = {
  docId: string;
  /** The tab is the one on screen. */
  visible: boolean;
  onClose: () => void;
  onTitle: (title: string) => void;
  /**
   * "tab" fills a Reader tab and takes the keyboard when it shows. "dock" sits
   * under another tab's content: it never takes the focus by itself, its
   * controls never float, and Escape hands the keyboard back.
   */
  variant?: "tab" | "dock";
  /** Before the title in the header, such as the library button. */
  headerStart?: ReactNode;
  /** At the end of the header, such as "open as a tab" and close. */
  headerEnd?: ReactNode;
  /** Escape with nothing left to clear. */
  onEscape?: () => void;
};

/** The Reader's app-wide chords, as Settings, Shortcuts lists them by default. */
const GLOBAL_MOD = IS_MAC ? "⌘⌥" : "Ctrl+Alt+";

/** Where the reading line settles, as a share of the viewport height. */
const READING_LINE = 0.4;

export function ReaderPane({
  docId,
  visible,
  onClose,
  onTitle,
  variant = "tab",
  headerStart,
  headerEnd,
  onEscape,
}: Props) {
  const docked = variant === "dock";
  const entry = useReaderStore((s) => s.docs[docId]);
  const playback = useReaderStore((s) => s.playback);
  const floatingPref = useReaderStore((s) => s.floating);
  const floating = floatingPref && !docked;
  const setFloating = useReaderStore((s) => s.setFloating);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [freeScroll, setFreeScroll] = useState(false);
  const [help, setHelp] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const loaded = entry !== undefined;

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    loadStored(docId)
      .then((doc) => {
        if (!cancelled) onTitleRef.current(doc.state.title);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [docId, loaded]);

  const live = playback.docId === docId;
  const reading = entry
    ? live
      ? playback.wordIndex
      : entry.state.lastWordIndex
    : 0;
  const readingSegment = entry
    ? live
      ? playback.segment
      : (entry.doc.words[reading]?.segment ?? 0)
    : 0;
  const sounding =
    live &&
    (playback.phase === "playing" ||
      playback.phase === "gap" ||
      playback.phase === "loading");

  // Keyed on the text and the cuts only: a clip length learned mid-reading
  // must not re-render every block that carries a mark.
  const doc = entry?.doc;
  const userCuts = entry?.state.cutPoints;
  const cutsByBlock = useMemo(() => {
    const out = new Map<number, CutPoint[]>();
    if (!doc || !userCuts) return out;
    for (const cut of allCuts(doc, userCuts)) {
      const block = doc.words[cut.wordIndex]?.block;
      if (block === undefined) continue;
      const list = out.get(block) ?? [];
      list.push(cut);
      out.set(block, list);
    }
    return out;
  }, [doc, userCuts]);

  const scrollToWord = useCallback((wordIndex: number, smooth = true) => {
    const container = scrollRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-w="${wordIndex}"]`);
    if (!container || !el) return;
    const box = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const y = rect.top - box.top;
    // Leave the view alone while the word sits comfortably in the middle band.
    if (smooth && y > box.height * 0.2 && y < box.height * 0.7) return;
    container.scrollTo({
      top: container.scrollTop + y - box.height * READING_LINE,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  // Follow the reading point unless the user scrolled away.
  useEffect(() => {
    if (!entry || !visible || freeScroll) return;
    scrollToWord(reading);
  }, [entry, visible, freeScroll, reading, scrollToWord]);

  // Land on the saved point when the tab first shows.
  const landed = useRef(false);
  useEffect(() => {
    if (!entry || !visible || landed.current) return;
    landed.current = true;
    requestAnimationFrame(() => scrollToWord(reading, false));
  }, [entry, visible, reading, scrollToWord]);

  const target = cursor ?? reading;

  const cut = useCallback(
    (kind: "bookmark" | "pause" | "stop") => {
      if (!entry) return;
      const added = toggleReaderCut(docId, kind, target);
      const noun =
        kind === "bookmark" ? "Bookmark" : kind === "pause" ? "Pause" : "Stop";
      toast.message(`${noun} ${added ? "added" : "removed"}`, {
        description: `Before "${entry.doc.words[target]?.text ?? ""}"`,
        duration: 1500,
      });
    },
    [docId, entry, target],
  );

  const runExport = useCallback(
    (split: ExportSplit = "none") => exportWithToast(docId, split),
    [docId],
  );

  const toggleFloating = useCallback(() => {
    if (!docked) setFloating(!floating);
  }, [docked, floating, setFloating]);

  const playFrom = useCallback(
    (wordIndex: number) => {
      setCursor(null);
      setFreeScroll(false);
      void playReader(docId, wordIndex).catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : String(err));
      });
    },
    [docId],
  );

  const run = useCallback(
    (action: ReaderAction) => {
      if (!entry) return;
      const doc = entry.doc;
      const last = Math.max(0, doc.words.length - 1);
      switch (action.type) {
        case "toggle":
          if (cursor !== null && !sounding) {
            playFrom(cursor);
          } else {
            setFreeScroll(false);
            void toggleReader(docId).catch((err: unknown) =>
              toast.error(err instanceof Error ? err.message : String(err)),
            );
          }
          return;
        case "segment":
          setCursor(null);
          setFreeScroll(false);
          void stepReader(docId, action.delta);
          return;
        case "skipMs":
          setFreeScroll(false);
          void skipReader(docId, action.deltaMs);
          return;
        case "scroll":
          setFreeScroll(true);
          scrollRef.current?.scrollBy({
            top: action.lines * 24,
            behavior: "smooth",
          });
          return;
        case "page":
          setFreeScroll(true);
          scrollRef.current?.scrollBy({
            top: action.direction * (scrollRef.current.clientHeight * 0.85),
            behavior: "smooth",
          });
          return;
        case "cursorWord": {
          const next = Math.max(0, Math.min(last, target + action.delta));
          setCursor(next);
          setFreeScroll(true);
          scrollToWord(next);
          return;
        }
        case "cursorBlock": {
          const next = nextBlockWord(doc, target, action.delta);
          if (next === null) return;
          setCursor(next);
          setFreeScroll(true);
          scrollToWord(next);
          return;
        }
        case "playCursor":
          playFrom(target);
          return;
        case "center":
          setCursor(null);
          setFreeScroll(false);
          scrollToWord(reading, false);
          return;
        case "cut":
          cut(action.kind);
          return;
        case "jumpCut": {
          const found = adjacentCut(
            allCuts(doc, entry.state.cutPoints),
            target,
            action.direction,
          );
          if (!found) return;
          if (sounding) {
            playFrom(found.wordIndex);
          } else {
            setCursor(found.wordIndex);
            setFreeScroll(true);
            scrollToWord(found.wordIndex);
          }
          return;
        }
        case "speed":
          setReaderSpeed(docId, stepSpeed(entry.state.speed, action.direction));
          return;
        case "float":
          toggleFloating();
          return;
        case "export":
          runExport();
          return;
        case "quit":
          onClose();
          return;
        case "escape":
          if (!help && cursor === null && !freeScroll) {
            onEscape?.();
            return;
          }
          if (help) setHelp(false);
          setCursor(null);
          setFreeScroll(false);
          return;
      }
    },
    [
      entry,
      cursor,
      sounding,
      playFrom,
      docId,
      target,
      scrollToWord,
      reading,
      cut,
      toggleFloating,
      runExport,
      onClose,
      help,
      freeScroll,
      onEscape,
    ],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      e.target instanceof HTMLElement &&
      e.target.closest("input, textarea, [role=menu]")
    )
      return;
    if (e.key === "?") {
      setHelp((h) => !h);
      e.preventDefault();
      return;
    }
    const action = readerKeyAction(e);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    run(action);
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-w]");
    if (!el) return;
    // Keep text selection usable: a drag that selected something is not a click.
    if (window.getSelection()?.toString()) return;
    const index = Number(el.dataset.w);
    if (!Number.isInteger(index)) return;
    if (e.altKey) {
      setCursor(index);
      moveCursorTo(docId, index);
      return;
    }
    playFrom(index);
  };

  // Keyboard goes to the pane as soon as its tab shows. A docked panel waits
  // for a click: the tab above it keeps the keyboard.
  useEffect(() => {
    if (!docked && visible && entry)
      rootRef.current?.focus({ preventScroll: true });
  }, [docked, visible, entry]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        This document is not in the Reader library anymore ({loadError}).
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Opening...
      </div>
    );
  }

  const progress =
    entry.doc.words.length > 0
      ? Math.round((reading / entry.doc.words.length) * 100)
      : 0;

  return (
    <div
      ref={rootRef}
      // A keyboard-driven widget: every key in the map is handled here.
      role="application"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the pane takes the Reader shortcuts
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative flex h-full min-h-0 flex-col outline-none"
      aria-label={`Reader: ${entry.state.title}`}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b text-[12px] text-muted-foreground",
          docked ? "px-2 py-1" : "px-4 py-1.5",
        )}
      >
        {headerStart}
        <span className="min-w-0 truncate font-medium text-foreground">
          {entry.state.title}
        </span>
        {entry.state.sourcePath ? (
          <span className="min-w-0 truncate">{entry.state.sourcePath}</span>
        ) : entry.state.origin?.label && docked ? (
          <span className="min-w-0 truncate">{entry.state.origin.label}</span>
        ) : null}
        <span className="flex-1" />
        <span className="shrink-0 tabular-nums">
          {entry.doc.words.length.toLocaleString()} words, {progress}%
        </span>
        <button
          type="button"
          className="shrink-0 rounded px-1.5 hover:bg-accent hover:text-foreground"
          onClick={() => setHelp((h) => !h)}
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
        {headerEnd}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: clicks pick a word; the keyboard has its own map on the pane */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onWheel={() => setFreeScroll(true)}
        onTouchMove={() => setFreeScroll(true)}
        onClick={onClick}
      >
        <article
          className={cn(
            "mx-auto max-w-[72ch] font-serif",
            docked
              ? "px-12 pt-4 pb-[60%] text-[15px] leading-[1.7]"
              : "px-12 pt-10 pb-[45vh] text-[17px] leading-[1.75]",
          )}
        >
          <ReaderText
            doc={entry.doc}
            segment={readingSegment}
            word={reading}
            live={sounding}
            cursor={cursor}
            cutsByBlock={cutsByBlock}
          />
        </article>
      </div>
      {freeScroll && (sounding || cursor !== null) ? (
        <button
          type="button"
          className={cn(
            "absolute right-5 rounded-full border bg-background/95 px-3 py-1 text-[12px] shadow-md hover:bg-accent",
            docked ? "bottom-24" : "bottom-28",
          )}
          onClick={() => run({ type: "center" })}
        >
          Back to the reading point (c)
        </button>
      ) : null}
      {help ? (
        <div className="absolute top-10 right-4 z-10 w-72 rounded-lg border bg-popover p-3 text-[12px] shadow-lg">
          <div className="mb-2 font-medium">Reader shortcuts</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {READER_KEY_HELP.map((k) => (
              <div key={k.keys} className="contents">
                <dt className="font-mono text-muted-foreground">{k.keys}</dt>
                <dd>{k.label}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 text-muted-foreground">
            Alt+click moves the cursor without playing. Write [pause: 2s] or
            [stop] in the text to script cuts.
          </div>
          <div className="mt-2 text-muted-foreground">
            From any tab: {GLOBAL_MOD}P play or pause, {GLOBAL_MOD}← →
            sentences, {GLOBAL_MOD}= − speed, {GLOBAL_MOD}R read here,{" "}
            {GLOBAL_MOD}B panel. The media keys and the system's Now Playing
            controls work too.
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "shrink-0 border-t bg-background/95",
          docked ? "px-3 py-1.5" : "px-4 py-2",
          floating && "hidden",
        )}
      >
        <ReaderTransport
          docId={docId}
          targetWord={target}
          onCut={cut}
          onExport={runExport}
          compact={docked}
          onToggleFloating={docked ? undefined : toggleFloating}
        />
      </div>
    </div>
  );
}
