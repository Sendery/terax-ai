import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { ttsDeviceFor } from "@/modules/settings/store";
import {
  hasInstalledEngine,
  isEngineRunning,
} from "@/modules/tts/lib/engineControl";
import {
  engineOf,
  LANGUAGE_LABELS,
  type TtsLanguage,
} from "@/modules/tts/lib/engines";
import { ttsNative } from "@/modules/tts/lib/native";
import { useVoiceOptions } from "@/modules/tts/lib/useVoiceOptions";
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

/** Ready voices shown before the list sends the user to Settings. */
const MAX_READY = 12;
/** Voices that still need something, shown so the menu says what exists. */
const MAX_PENDING = 4;

const SHELL =
  "flex h-6 min-w-0 items-center rounded-md border border-border/50 bg-card/60 text-[11px] text-muted-foreground";
const BUTTON =
  "flex h-full items-center gap-1 rounded-l-md px-1.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60";

/**
 * Start/stop for the engine behind the active voice, with a picker for the
 * default voice of each enabled language (the same list as Settings, the
 * Reader and agents). Renders nothing until an engine is installed, so a
 * window that never uses speech shows no control and reads the status once.
 */
export function TtsEngineControl() {
  const status = useTtsStore((s) => s.status);
  const profiles = useTtsStore((s) => s.profiles);
  const defaults = useTtsStore((s) => s.defaults);
  const setStatus = useTtsStore((s) => s.setStatus);
  const setDefaultProfile = useTtsStore((s) => s.setDefaultProfile);
  const hydrate = useTtsStore((s) => s.hydrate);
  const defaultLanguage = usePreferencesStore((s) => s.ttsDefaultLanguage);
  const enabled = usePreferencesStore((s) => s.ttsLanguages);
  const devices = usePreferencesStore((s) => s.ttsDevices);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<TtsLanguage | null>(null);
  const language = shown ?? defaultLanguage;
  const options = useVoiceOptions({ language });

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
    ttsDefaultLanguage: defaultLanguage,
  });
  if (!hasInstalledEngine(status)) return null;

  const model = voice?.model ?? null;
  const engine = model ? engineOf(model) : null;
  const running = engine ? isEngineRunning(status, engine) : false;
  const ready = options.filter((o) => o.ready).slice(0, MAX_READY);
  const pending = options.filter((o) => !o.ready).slice(0, MAX_PENDING);

  const toggle = async () => {
    setBusy(true);
    try {
      if (running) {
        await stopEngines();
      } else if (engine) {
        await ttsNative.start(engine, ttsDeviceFor(devices, engine));
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
              className={cn(BUTTON, "shrink-0")}
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
              : voice
                ? `Load ${voice.name}'s engine so the first read aloud is instant.`
                : "No voice is configured yet. Add one in Settings, Voice."}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu onOpenChange={(open) => (open ? undefined : setShown(null))}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-full min-w-0 items-center gap-1 rounded-r-md border-l border-border/40 px-1.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label="Choose the default voice"
            >
              <span className="min-w-0 max-w-[110px] truncate">
                {voice ? voice.name : "No voice"}
              </span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={11}
                strokeWidth={2}
                className="opacity-70"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {enabled.length > 1 ? (
              <>
                <DropdownMenuRadioGroup
                  value={language}
                  onValueChange={(value) => setShown(value as TtsLanguage)}
                >
                  {enabled.map((l) => (
                    <DropdownMenuRadioItem
                      key={l}
                      value={l}
                      className="text-[11.5px]"
                      onSelect={(event) => event.preventDefault()}
                    >
                      {LANGUAGE_LABELS[l]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuLabel className="text-[10.5px] font-normal text-muted-foreground">
              Default {LANGUAGE_LABELS[language]} voice
            </DropdownMenuLabel>
            {ready.map((option) => (
              <DropdownMenuItem
                key={option.id}
                className="flex items-center justify-between gap-2 text-[11.5px]"
                onSelect={() => void setDefaultProfile(language, option.id)}
              >
                <span className="truncate">{option.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {option.isDefault ? "Default" : option.provider}
                </span>
              </DropdownMenuItem>
            ))}
            {pending.length > 0 ? <DropdownMenuSeparator /> : null}
            {pending.map((option) => (
              <DropdownMenuItem
                key={option.id}
                disabled
                className="flex items-center justify-between gap-2 text-[11.5px]"
              >
                <span className="truncate">{option.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {option.missing}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[11.5px]"
              onSelect={() => void openSettingsWindow("voice")}
            >
              Voice settings...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}
