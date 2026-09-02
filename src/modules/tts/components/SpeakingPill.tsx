import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSpeaker } from "@/modules/tts/lib/useSpeaker";
import {
  AlertCircleIcon,
  AudioWave01Icon,
  Cancel01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const PILL =
  "flex h-6 items-center gap-1.5 rounded-md border px-1.5 text-[11px] transition-colors animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out";
const ACTION =
  "flex size-4 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

/**
 * Status-bar pill. Renders nothing until this window speaks or starts an
 * engine, so the feature costs no pixels and no listeners until it is used.
 */
export function SpeakingPill() {
  const {
    speaking,
    currentVoice,
    progress,
    error,
    runningEngines,
    stop,
    stopEngines,
    clearError,
  } = useSpeaker();

  if (speaking) {
    const position =
      progress.total > 1 ? `${progress.index + 1}/${progress.total}` : null;
    return (
      <div
        className={cn(PILL, "border-border/60 bg-card text-foreground")}
        aria-live="polite"
      >
        <HugeiconsIcon
          icon={AudioWave01Icon}
          size={12}
          strokeWidth={1.75}
          className="text-muted-foreground"
        />
        <span className="max-w-[140px] truncate">
          Reading{currentVoice ? ` as ${currentVoice.name}` : ""}
        </span>
        {position ? (
          <span className="text-muted-foreground tabular-nums">{position}</span>
        ) : null}
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

  if (runningEngines.length === 0) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              PILL,
              "border-border/50 bg-card/60 text-muted-foreground hover:text-foreground",
            )}
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
    </TooltipProvider>
  );
}
