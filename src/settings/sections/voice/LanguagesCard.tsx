import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setTtsDefaultLanguage, setTtsLanguages } from "@/modules/settings/store";
import {
  engineStatusOf,
  LANGUAGE_LABELS,
  MODEL_LANGUAGES,
  modelsOfEngine,
  TTS_ENGINES,
  TTS_LANGUAGES,
  type TtsEngineId,
  type TtsLanguage,
  type TtsStatus,
  useTtsStore,
  voiceOptions,
} from "@/modules/tts";
import { Add01Icon, Cancel01Icon, LanguageSkillIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Card } from "./ui";

/** Providers that speak `language`, and how many of them are installed. */
export function languageProviders(
  language: TtsLanguage,
  status: TtsStatus | null,
): { engines: TtsEngineId[]; installed: number } {
  const engines = TTS_ENGINES.filter((engine) =>
    modelsOfEngine(engine).some((model) => MODEL_LANGUAGES[model].includes(language)),
  );
  const installed = engines.filter(
    (engine) => engineStatusOf(status, engine)?.installed,
  ).length;
  return { engines, installed };
}

/**
 * The languages Terax reads in. Each has its default voice; the Reader detects
 * which of these a document is in. A language can be added only when some
 * provider speaks it.
 */
export function LanguagesCard({ status }: { status: TtsStatus | null }) {
  const enabled = usePreferencesStore((s) => s.ttsLanguages);
  const defaultLanguage = usePreferencesStore((s) => s.ttsDefaultLanguage);
  const profiles = useTtsStore((s) => s.profiles);
  const defaults = useTtsStore((s) => s.defaults);
  const setDefaultProfile = useTtsStore((s) => s.setDefaultProfile);
  const addable = TTS_LANGUAGES.filter(
    (l) => !enabled.includes(l) && languageProviders(l, status).engines.length > 0,
  );

  return (
    <Card
      title="Languages"
      icon={LanguageSkillIcon}
      subtitle="Each language reads with its default voice. The Reader detects which of these a document is written in."
    >
      <div className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-[11px] text-muted-foreground">
          When unsure, read in
        </span>
        <Select
          value={defaultLanguage}
          onValueChange={(value) => void setTtsDefaultLanguage(value as TtsLanguage)}
        >
          <SelectTrigger
            aria-label="Default language for read aloud"
            className="h-8 w-full text-[11.5px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {enabled.map((id) => (
              <SelectItem key={id} value={id} className="text-[12px]">
                {LANGUAGE_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ul className="flex flex-col gap-1.5">
        {enabled.map((language) => {
          const options = voiceOptions(profiles, defaults, status, { language });
          const ready = options.filter((o) => o.ready || o.isDefault);
          const current = options.find((o) => o.isDefault);
          const providers = languageProviders(language, status);
          return (
            <li
              key={language}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
            >
              <span className="flex w-28 shrink-0 flex-col">
                <span className="text-[12px] font-medium">
                  {LANGUAGE_LABELS[language]}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {providers.installed} of {providers.engines.length} providers
                  installed
                </span>
              </span>
              <div className="min-w-40 flex-1">
                <Select
                  value={current?.id ?? ""}
                  onValueChange={(value) =>
                    void setDefaultProfile(language, value || null)
                  }
                >
                  <SelectTrigger
                    aria-label={`Default ${LANGUAGE_LABELS[language]} voice`}
                    className="h-8 w-full text-[11.5px]"
                  >
                    <SelectValue placeholder="Choose a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {ready.map((o) => (
                      <SelectItem key={o.id} value={o.id} className="text-[12px]">
                        {o.name} · {o.provider}
                        {o.ready ? "" : ` (${o.missing})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                disabled={language === defaultLanguage}
                title={
                  language === defaultLanguage
                    ? "The default language cannot be removed"
                    : `Stop offering ${LANGUAGE_LABELS[language]}`
                }
                aria-label={`Remove ${LANGUAGE_LABELS[language]}`}
                onClick={() =>
                  void setTtsLanguages(enabled.filter((l) => l !== language))
                }
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
              </Button>
            </li>
          );
        })}
      </ul>

      {addable.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            Add a language
          </span>
          <div className="flex flex-wrap gap-1.5">
            {addable.map((language) => {
              const providers = languageProviders(language, status);
              return (
                <Button
                  key={language}
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => void setTtsLanguages([...enabled, language])}
                >
                  <HugeiconsIcon icon={Add01Icon} size={11} strokeWidth={1.75} />
                  {LANGUAGE_LABELS[language]}
                  <span className="text-[10px] text-muted-foreground">
                    {providers.installed}/{providers.engines.length} installed
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
