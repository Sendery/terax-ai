import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MODEL_LABELS } from "@/modules/tts/lib/engines";
import { formatClock } from "@/modules/tts/lib/format";
import { useSpeaker } from "@/modules/tts/lib/useSpeaker";
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  AudioWave01Icon,
  Cancel01Icon,
  Clock01Icon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const PILL =
  "flex h-6 items-center gap-1.5 rounded-md border px-1.5 text-[11px] transition-colors animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out";
const ACTION =
  "flex size-4 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40";

/**
 * Status-bar transport. Renders nothing until this window speaks, starts an
 * engine or has something to replay, so the feature costs no pixels and no
 * listeners until it is used.
 */
export function SpeakingPill() {
  const {
    speaking,
    paused,
    currentVoice,
    progress,
    elapsed,
    duration,
    history,
    error,
    runningEngines,
    replay,
    togglePause,
    seek,
    stop,
    stopEngines,
    clearError,
    forgetHistory,
  } = useSpeaker();

  if (speaking) {
    const position =
      progress.total > 1 ? `${progress.index + 1}/${progress.total}` : null;
    return (
      <TooltipProvider delayDuration={300}>
        <div
          className={cn(PILL, "border-border/60 bg-card text-foreground")}
          aria-live="polite"
        >
          <HugeiconsIcon
            icon={AudioWave01Icon}
            size={12}
            strokeWidth={1.75}
            className={cn(
              "text-muted-foreground",
              paused && "opacity-50",
            )}
          />
          <span className="max-w-[120px] truncate">
            {paused ? "Paused" : "Reading"}
            {currentVoice ? ` · ${currentVoice.name}` : ""}
          </span>

          <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
            {formatClock(elapsed)}/{formatClock(duration)}
          </span>
          {position ? (
            <span className="text-muted-foreground tabular-nums">
              {position}
            </span>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={ACTION}
                onClick={() => seek(-1)}
                aria-label="Previous part"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={11} strokeWidth={2} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">
              Restart this part, or go back to the previous one
            </TooltipContent>
          </Tooltip>

          <button
            type="button"
            className={ACTION}
            onClick={() => togglePause()}
            aria-label={paused ? "Resume reading" : "Pause reading"}
            title={paused ? "Resume" : "Pause"}
          >
            <HugeiconsIcon
              icon={paused ? PlayIcon : PauseIcon}
              size={11}
              strokeWidth={2}
            />
          </button>

          <button
            type="button"
            className={ACTION}
            disabled={progress.index + 1 >= progress.total}
            onClick={() => seek(1)}
            aria-label="Next part"
            title="Next part"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={11} strokeWidth={2} />
          </button>

          <button
            type="button"
            className={ACTION}
            onClick={() => stop()}
            aria-label="Stop reading aloud"
            title="Stop reading aloud"
          >
            <HugeiconsIcon icon={StopIcon} size={11} strokeWidth={2} />
          </button>
        </div>
      </TooltipProvider>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          PILL,
          "border-destructive/40 bg-destructive/10 text-destructive",
        )}
        aria-live="polite"
      >
        <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
        <span className="max-w-[220px] truncate" title={error}>
          {error}
        </span>
        <button
          type="button"
          className={cn(ACTION, "text-destructive/80 hover:text-destructive")}
          onClick={clearError}
          aria-label="Dismiss the speech error"
          title="Dismiss"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
        </button>
      </div>
    );
  }

  const idle = runningEngines.length > 0;
  if (!idle && history.length === 0) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          PILL,
          "border-border/50 bg-card/60 text-muted-foreground",
        )}
      >
        {history.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={ACTION}
                aria-label="Recently read aloud"
                title="Recently read aloud"
              >
                <HugeiconsIcon icon={Clock01Icon} size={12} strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between gap-2 text-[10.5px] font-normal text-muted-foreground">
                <span>Recently read aloud</span>
                <button
                  type="button"
                  className="rounded px-1 text-[10.5px] hover:text-foreground"
                  onClick={() => forgetHistory()}
                >
                  Clear
                </button>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {history.map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  className="flex flex-col items-start gap-0.5 text-[11.5px]"
                  onSelect={() => void replay(entry)}
                >
                  <span className="line-clamp-2 w-full">{entry.preview}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {entry.voiceName} · {MODEL_LABELS[entry.model]}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {idle ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                onClick={() => void stopEngines()}
                aria-label="Stop the speech engine"
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-muted-foreground/70"
                />
                <span>TTS ready</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">
              The speech engine is loaded and idle. Click to stop it and free its
              memory.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
