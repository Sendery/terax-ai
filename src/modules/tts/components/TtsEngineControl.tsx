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
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  hasInstalledEngine,
  isEngineRunning,
  modelChoices,
} from "@/modules/tts/lib/engineControl";
import { engineOf, MODEL_LABELS } from "@/modules/tts/lib/engines";
import { ttsNative } from "@/modules/tts/lib/native";
import { stopEngines } from "@/modules/tts/lib/useSpeaker";
import { resolveVoice } from "@/modules/tts/lib/voices";
import { useTtsStore } from "@/modules/tts/store/ttsStore";
import {
  ArrowDown01Icon,
  PlayIcon,
  StopIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";

const SHELL =
  "flex h-6 items-center rounded-md border border-border/50 bg-card/60 text-[11px] text-muted-foreground";
const BUTTON =
  "flex h-full items-center gap-1 rounded-l-md px-1.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60";

/**
 * Start/stop for the engine behind the active voice, with a picker for which
 * model speaks. Renders nothing until an engine is installed, so a window that
 * never uses speech shows no control and reads the status once.
 */
export function TtsEngineControl() {
  const status = useTtsStore((s) => s.status);
  const profiles = useTtsStore((s) => s.profiles);
  const defaults = useTtsStore((s) => s.defaults);
  const setStatus = useTtsStore((s) => s.setStatus);
  const setDefaultProfile = useTtsStore((s) => s.setDefaultProfile);
  const hydrate = useTtsStore((s) => s.hydrate);
  const language = usePreferencesStore((s) => s.ttsDefaultLanguage);
  const device = usePreferencesStore((s) => s.ttsDevice);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await ttsNative.status());
    } catch {
      // Nothing to show in the status bar; Settings reports the real error.
    }
  }, [setStatus]);

  useEffect(() => {
    void hydrate();
    void refresh();
  }, [hydrate, refresh]);

  const voice = resolveVoice(profiles, defaults, {
    ttsDefaultLanguage: language,
  });
  if (!hasInstalledEngine(status)) return null;

  const model = voice?.model ?? null;
  const engine = model ? engineOf(model) : null;
  const running = engine ? isEngineRunning(status, engine) : false;
  const choices = modelChoices(status, profiles, language);

  const toggle = async () => {
    setBusy(true);
    try {
      if (running) {
        await stopEngines();
      } else if (engine) {
        await ttsNative.start(engine, device);
      }
      await refresh();
    } catch {
      // Same reasoning as refresh: the Voice tab owns error reporting.
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn(SHELL, running && "text-foreground")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={BUTTON}
              disabled={busy || !engine}
              onClick={() => void toggle()}
              aria-label={
                running ? "Stop the speech engine" : "Start the speech engine"
              }
            >
              <HugeiconsIcon
                icon={running ? StopIcon : PlayIcon}
                size={11}
                strokeWidth={2}
              />
              <HugeiconsIcon
                icon={VolumeHighIcon}
                size={12}
                strokeWidth={1.75}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-64 text-[11px]">
            {running
              ? "The speech engine is loaded. Stop it to free its memory."
              : model
                ? `Load ${MODEL_LABELS[model]} so the first read aloud is instant.`
                : "No voice is configured yet. Add one in Settings, Voice."}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-full items-center gap-1 rounded-r-md border-l border-border/40 px-1.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label="Choose the speech model"
            >
              <span className="max-w-[92px] truncate">
                {model ? MODEL_LABELS[model] : "No voice"}
              </span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={11}
                strokeWidth={2}
                className="opacity-70"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="text-[10.5px] font-normal text-muted-foreground">
              Speaking {language === "es-ES" ? "Spanish" : "English"} with
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {choices.map((choice) => (
              <DropdownMenuItem
                key={choice.id}
                disabled={!!choice.blockedReason}
                className="flex items-center justify-between gap-2 text-[11.5px]"
                onSelect={() => {
                  if (!choice.profileId) return;
                  void setDefaultProfile(language, choice.profileId);
                }}
              >
                <span className="truncate">{choice.label}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {choice.blockedReason ??
                    (choice.id === model ? "Active" : "")}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}
