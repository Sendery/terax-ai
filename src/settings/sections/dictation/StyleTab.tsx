import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setSttLanguage,
  setSttLiveSegments,
  setSttMode,
} from "@/modules/settings/store";
import { applyMode } from "@/modules/stt/lib/postprocess";
import {
  STT_MODE_DESCRIPTIONS,
  STT_MODE_LABELS,
  STT_MODES,
  type SttLanguage,
} from "@/modules/stt/lib/settings";
import { LANGUAGE_LABELS, TTS_LANGUAGES } from "@/modules/tts";
import { Clock01Icon, LanguageSkillIcon, TextFontIcon } from "@hugeicons/core-free-icons";
import { Card, Row } from "../voice/ui";

/** What the model returns for a short dictation, before any style. */
const EXAMPLE = "Revisa el fichero de configuración. Después abre una pull request.";

export function StyleTab() {
  const language = usePreferencesStore((s) => s.sttLanguage);
  const mode = usePreferencesStore((s) => s.sttMode);
  const dictionary = usePreferencesStore((s) => s.sttDictionary);
  const live = usePreferencesStore((s) => s.sttLiveSegments);

  return (
    <section className="flex flex-col gap-3">
      <Card
        title="Language"
        icon={LanguageSkillIcon}
        subtitle="Automatic detects the language of every segment, so you can switch mid-dictation."
      >
        <Row label="Speak in">
          <Select
            value={language}
            onValueChange={(value) => void setSttLanguage(value as SttLanguage)}
          >
            <SelectTrigger aria-label="Dictation language" className="h-8 w-full text-[11.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-[12px]">
                Automatic
              </SelectItem>
              {TTS_LANGUAGES.map((id) => (
                <SelectItem key={id} value={id} className="text-[12px]">
                  {LANGUAGE_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <p className="text-[10.5px] text-muted-foreground">
          The Light model understands 45 languages; fixing one avoids a wrong
          guess on very short phrases. Applies to the local engine only.
        </p>
      </Card>

      <Card
        title="Writing style"
        icon={TextFontIcon}
        subtitle="How the transcript is tidied before it reaches the chat box."
      >
        <fieldset aria-label="Writing style" className="m-0 grid min-w-0 gap-1.5 border-0 p-0 sm:grid-cols-2">
          {STT_MODES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => void setSttMode(id)}
              className={cn(
                "flex min-w-0 flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors",
                mode === id
                  ? "border-primary/60 bg-primary/5"
                  : "border-border/60 bg-card/40 hover:bg-accent/40",
              )}
            >
              <span className="text-[11.5px] font-medium">{STT_MODE_LABELS[id]}</span>
              <span className="text-[10.5px] text-muted-foreground">
                {STT_MODE_DESCRIPTIONS[id]}
              </span>
              <span className="truncate font-mono text-[10px] text-foreground/80">
                {applyMode(EXAMPLE, id, dictionary)}
              </span>
            </button>
          ))}
        </fieldset>
        <p className="text-[10.5px] text-muted-foreground">
          Self-corrections such as "de arquitectura, perdón, de requisitos" stay as
          spoken: rewriting them needs the language model of the Medium tier.
        </p>
      </Card>

      <Card
        title="Live segments"
        icon={Clock01Icon}
        subtitle="Transcribe while you speak, cutting at pauses, so only the last phrase is left when you stop."
        action={
          <Switch
            checked={live}
            onCheckedChange={(checked) => void setSttLiveSegments(checked)}
            aria-label="Transcribe while recording"
          />
        }
      >
        <p className="text-[10.5px] text-muted-foreground">
          {live
            ? "On: a pause of 0.6 s after at least 2 s of speech sends that part to the engine."
            : "Off: the whole recording is transcribed when you stop."}{" "}
          Local engine only.
        </p>
      </Card>
    </section>
  );
}
