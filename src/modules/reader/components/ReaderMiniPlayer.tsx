import { cn } from "@/lib/utils";
import {
  exportReader,
  stopReader,
  toggleReaderCut,
} from "@/modules/reader/lib/player";
import { useReaderStore } from "@/modules/reader/store/readerStore";
import {
  BookOpen01Icon,
  Cancel01Icon,
  PictureInPictureOnIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { ReaderTransport } from "./ReaderTransport";

type Props = {
  /** Doc id of the Reader tab on screen, if one is. */
  visibleDocId: string | null;
  onOpenDoc: (docId: string) => void;
};

const ICON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

/**
 * Floating controls for the document being read. They show when the user
 * floats the controls, or when the reading continues behind another tab, so
 * the reading follows them around the workspace.
 */
export function ReaderMiniPlayer({ visibleDocId, onOpenDoc }: Props) {
  const playback = useReaderStore((s) => s.playback);
  const floating = useReaderStore((s) => s.floating);
  const setFloating = useReaderStore((s) => s.setFloating);
  const docId = playback.docId ?? (floating ? visibleDocId : null);
  const entry = useReaderStore((s) => (docId ? s.docs[docId] : undefined));
  if (!docId || !entry) return null;
  const onScreen = docId === visibleDocId;
  const live = playback.docId === docId;
  const sounding =
    live &&
    (playback.phase === "playing" ||
      playback.phase === "loading" ||
      playback.phase === "gap");
  // A paused reading follows you around, unless another Reader tab is on
  // screen: its own controls are the ones that matter there.
  const active =
    live && playback.phase !== "idle" && (sounding || visibleDocId === null);
  if (!floating && (onScreen || !active)) return null;
  if (floating && !onScreen && !active) return null;
  // Docked controls of the Reader tab on screen sit at the bottom; float above them.
  const aboveDock = visibleDocId !== null && !floating;

  const word =
    playback.docId === docId ? playback.wordIndex : entry.state.lastWordIndex;
  return (
    <section
      className={cn(
        "pointer-events-auto fixed left-1/2 z-40 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border bg-popover/95 px-3 py-2 shadow-xl backdrop-blur",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-150",
        aboveDock ? "bottom-32" : "bottom-9",
      )}
      aria-label="Reader controls"
    >
      <div className="mb-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <HugeiconsIcon icon={BookOpen01Icon} size={12} />
        <span className="truncate text-foreground">{entry.state.title}</span>
        <span className="truncate">"{entry.doc.words[word]?.text ?? ""}"</span>
      </div>
      <ReaderTransport
        docId={docId}
        compact
        targetWord={word}
        onCut={(kind) => {
          toggleReaderCut(docId, kind, word);
        }}
        onExport={() => {
          toast.promise(exportReader(docId), {
            loading: "Exporting the reading as audio...",
            success: (r) => ({
              message: "Audio exported",
              description: r.path,
              duration: 10_000,
            }),
            error: (err: unknown) =>
              err instanceof Error ? err.message : String(err),
          });
        }}
        onToggleFloating={() => setFloating(!floating)}
        trailing={
          <>
            {!onScreen ? (
              <button
                type="button"
                className={ICON}
                title="Open the document"
                onClick={() => onOpenDoc(docId)}
              >
                <HugeiconsIcon icon={BookOpen01Icon} size={14} />
              </button>
            ) : null}
            {floating ? (
              <button
                type="button"
                className={ICON}
                title="Dock under the text (f)"
                onClick={() => setFloating(false)}
              >
                <HugeiconsIcon icon={PictureInPictureOnIcon} size={14} />
              </button>
            ) : null}
            <button
              type="button"
              className={ICON}
              title="Stop reading"
              onClick={() => stopReader()}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          </>
        }
      />
    </section>
  );
}
