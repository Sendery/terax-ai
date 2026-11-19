import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { allCuts, SPEEDS } from "@/modules/reader/lib/manifest";
import {
  pauseReader,
  resumeReader,
  seekReaderTo,
  setReaderSpeed,
  setReaderVoice,
  setStopAtBookmarks,
  skipReader,
  stepReader,
} from "@/modules/reader/lib/player";
import { formatClock } from "@/modules/reader/lib/timing";
import type { ExportSplit } from "@/modules/reader/lib/flow";
import { useReaderStore } from "@/modules/reader/store/readerStore";
import { LANGUAGE_LABELS } from "@/modules/tts/lib/engines";
import { useTtsStore } from "@/modules/tts/store/ttsStore";
import {
  Download01Icon,
  Flag01Icon,
  GoBackward10SecIcon,
  GoForward10SecIcon,
  NextIcon,
  PauseIcon,
  PictureInPictureOnIcon,
  PlayIcon,
  PreviousIcon,
  StopCircleIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, type ReactNode } from "react";

const BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40";
const CHIP =
  "flex h-6 min-w-0 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

type Props = {
  docId: string;
  /** Word the m / p buttons act on: the cursor, else the reading point. */
  targetWord: number;
  onCut: (kind: "bookmark" | "pause" | "stop") => void;
  onExport: (split: ExportSplit) => void;
  /** Absent where the controls cannot float, such as the docked panel. */
  onToggleFloating?: () => void;
  compact?: boolean;
  /** Extra controls at the end of the first row, such as "open tab". */
  trailing?: ReactNode;
};

export function ReaderTransport({
  docId,
  targetWord,
  onCut,
  onExport,
  onToggleFloating,
  compact = false,
  trailing,
}: Props) {
  const entry = useReaderStore((s) => s.docs[docId]);
  const playback = useReaderStore((s) => s.playback);
  const floating = useReaderStore((s) => s.floating);
  const profiles = useTtsStore((s) => s.profiles);
  const hydrate = useTtsStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!entry) return null;
  const live = playback.docId === docId;
  const phase = live ? playback.phase : "idle";
  const playing = phase === "playing" || phase === "gap" || phase === "loading";
  const reading = live ? playback.wordIndex : entry.state.lastWordIndex;
  const readingSegment = entry.doc.words[reading]?.segment ?? 0;
  const position = live
    ? playback.positionMs
    : (entry.timeline.starts[readingSegment] ?? 0);
  const speed = entry.state.speed;
  const total = entry.timeline.totalMs;
  const fraction = total > 0 ? Math.min(1, position / total) : 0;
  const cuts = allCuts(entry.doc, entry.state.cutPoints);
  const cutIndex = cuts.reduce(
    (at, cut, i) => (cut.wordIndex <= reading ? i : at),
    -1,
  );
  const lastCut = cutIndex >= 0 ? cuts[cutIndex] : null;
  const voice = profiles.find((p) => p.id === entry.state.voiceId) ?? null;
  // An export runs whether or not the document is the one playing.
  const exporting =
    playback.exporting?.docId === docId ? playback.exporting : null;
  const error = live ? playback.error : null;

  const toggle = () => {
    if (playing) pauseReader();
    else void resumeReader(docId);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        compact ? "text-[11px]" : "text-[12px]",
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          className={BUTTON}
          onClick={() => void stepReader(docId, -1)}
          title="Previous sentence (←)"
        >
          <HugeiconsIcon icon={PreviousIcon} size={15} />
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => void skipReader(docId, -10_000)}
          title="Back 10s (⇧←)"
        >
          <HugeiconsIcon icon={GoBackward10SecIcon} size={15} />
        </button>
        <button
          type="button"
          onClick={toggle}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={15} />
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => void skipReader(docId, 10_000)}
          title="Forward 10s (⇧→)"
        >
          <HugeiconsIcon icon={GoForward10SecIcon} size={15} />
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => void stepReader(docId, 1)}
          title="Next sentence (→)"
        >
          <HugeiconsIcon icon={NextIcon} size={15} />
        </button>
        <span className="ml-1 shrink-0 tabular-nums text-muted-foreground">
          {formatClock(position / speed)} / {formatClock(total / speed)}
        </span>
        <button
          type="button"
          className="group relative mx-2 h-4 min-w-12 flex-1 cursor-pointer"
          title="Seek"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const at = (e.clientX - rect.left) / Math.max(1, rect.width);
            void seekReaderTo(docId, at * total);
          }}
        >
          <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
          <span
            className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-amber-400"
            style={{ width: `${fraction * 100}%` }}
          />
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 ring-2 ring-background transition-transform group-hover:scale-125"
            style={{ left: `${fraction * 100}%` }}
          />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className={CHIP} title="Speed (+ / -)">
            <span className="tabular-nums">
              {speed.toFixed(2).replace(/0$/, "")}x
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={String(speed)}
              onValueChange={(v) => setReaderSpeed(docId, Number(v))}
            >
              {SPEEDS.map((s) => (
                <DropdownMenuRadioItem key={s} value={String(s)}>
                  {s}x
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {trailing}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
        <DropdownMenu>
          <DropdownMenuTrigger className={CHIP} title="Voice">
            <HugeiconsIcon icon={VolumeHighIcon} size={12} />
            <span className="max-w-40 truncate">
              {voice
                ? `${voice.name} (${voice.language.slice(0, 2).toUpperCase()})`
                : "Default voice"}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-80 overflow-y-auto"
          >
            <DropdownMenuLabel>Voice for this document</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={entry.state.voiceId ?? ""}
              onValueChange={(v) => void setReaderVoice(docId, v || null)}
            >
              <DropdownMenuRadioItem value="">
                Default for{" "}
                {entry.language
                  ? LANGUAGE_LABELS[entry.language]
                  : "the default language"}
              </DropdownMenuRadioItem>
              {profiles.map((p) => (
                <DropdownMenuRadioItem key={p.id} value={p.id}>
                  {p.name}{" "}
                  <span className="ml-1 text-muted-foreground">
                    {LANGUAGE_LABELS[p.language]}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="min-w-0 max-w-64 truncate" title={lastCut?.label}>
          {lastCut
            ? `Cut #${cutIndex + 1}: ${lastCut.label}`
            : `${cuts.length} cuts`}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className={CHIP}
          onClick={() => onCut("bookmark")}
          title="Bookmark the cursor word (m)"
        >
          <HugeiconsIcon icon={Flag01Icon} size={12} /> Mark
        </button>
        <button
          type="button"
          className={CHIP}
          onClick={() => onCut("pause")}
          title="Scripted 1.5s pause before the cursor word (p)"
        >
          ‖ Pause
        </button>
        <button
          type="button"
          className={CHIP}
          onClick={() => onCut("stop")}
          title="Stop before the cursor word (P)"
        >
          <HugeiconsIcon icon={StopCircleIcon} size={12} /> Stop
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className={CHIP} title="More">
            ...
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuCheckboxItem
              checked={entry.state.stopAtBookmarks}
              onCheckedChange={(v) => setStopAtBookmarks(docId, v === true)}
            >
              Study mode: stop at every bookmark
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onExport("none")}
              disabled={!!exporting}
            >
              <HugeiconsIcon icon={Download01Icon} size={14} /> Export audio (e)
            </DropdownMenuItem>
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">
              Export in fragments
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => onExport("heading")}
              disabled={!!exporting}
            >
              One file per section
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onExport("paragraph")}
              disabled={!!exporting}
            >
              One file per paragraph
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onExport("sentence")}
              disabled={!!exporting}
            >
              One file per sentence
            </DropdownMenuItem>
            {onToggleFloating ? (
              <DropdownMenuItem onSelect={onToggleFloating}>
                <HugeiconsIcon icon={PictureInPictureOnIcon} size={14} />
                {floating
                  ? "Dock controls under the text (f)"
                  : "Float the controls (f)"}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="sr-only">Word {targetWord + 1}</span>
      </div>
      {exporting ? (
        <div className="text-[11px] text-muted-foreground">
          Exporting: {exporting.done} / {exporting.total} clips ready
        </div>
      ) : null}
      {phase === "loading" ? (
        <div className="text-[11px] text-muted-foreground">
          Preparing the voice...
        </div>
      ) : null}
      {phase === "gap" ? (
        <div className="text-[11px] text-amber-500">Scripted pause</div>
      ) : null}
      {error ? <div className="text-[11px] text-red-500">{error}</div> : null}
    </div>
  );
}
