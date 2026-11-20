import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  LANGUAGE_LABELS,
  previewVoice,
  ttsNative,
  type TtsLanguage,
  useTtsStore,
  useVoiceOptions,
  type VoiceKind,
  type VoiceOption,
  type VoiceProfile,
} from "@/modules/tts";
import {
  Add01Icon,
  Delete02Icon,
  Download04Icon,
  Edit02Icon,
  Mic01Icon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { ErrorLine } from "./ui";

export type GalleryFilter = "all" | "ready" | "pending";

const KIND_LABELS: Record<VoiceKind, string> = {
  preset: "Preset",
  default: "Default voice",
  designed: "Designed",
  automatic: "Chosen by the model",
  builtin: "Built into the model",
  custom: "Your profile",
  cloned: "Cloned from your sample",
};

/** The options a filter keeps; exported for tests. */
export function filterVoices(
  options: readonly VoiceOption[],
  filter: GalleryFilter,
): VoiceOption[] {
  if (filter === "ready") return options.filter((o) => o.ready);
  if (filter === "pending") return options.filter((o) => !o.ready);
  return [...options];
}

type Props = {
  /** Re-reads the runtime after an install or download starts. */
  onChanged: () => void;
  onEdit: (profile: VoiceProfile) => void;
  onCustomize: (option: VoiceOption) => void;
  onNewClone: (language: TtsLanguage) => void;
  onAddLanguage: () => void;
};

/**
 * Every voice of one language, from every provider: the default on top, then
 * a grid with Listen and Use. A voice that cannot speak yet says what is
 * missing and offers that one action.
 */
export function VoicesGallery({
  onChanged,
  onEdit,
  onCustomize,
  onNewClone,
  onAddLanguage,
}: Props) {
  const enabled = usePreferencesStore((s) => s.ttsLanguages);
  const defaultLanguage = usePreferencesStore((s) => s.ttsDefaultLanguage);
  const [picked, setPicked] = useState<TtsLanguage | null>(null);
  const language =
    picked && enabled.includes(picked) ? picked : defaultLanguage;
  const options = useVoiceOptions({ language });
  const setDefaultProfile = useTtsStore((s) => s.setDefaultProfile);
  const removeProfile = useTtsStore((s) => s.removeProfile);
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const current = options.find((o) => o.isDefault) ?? null;
  const shown = filterVoices(options, filter);

  const act = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const listen = (option: VoiceOption) =>
    act(`listen:${option.id}`, () => previewVoice(option.profile));

  const fix = (option: VoiceOption) => {
    const r = option.readiness;
    if (r.state === "install") {
      return act(`fix:${option.id}`, () => ttsNative.installEngine(r.engine));
    }
    if (r.state === "download") {
      return act(`fix:${option.id}`, () => ttsNative.downloadModel(r.model));
    }
    if (r.state === "sample") onEdit(option.profile);
    return Promise.resolve();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <fieldset
          aria-label="Language"
          className="m-0 min-w-0 flex flex-wrap gap-1 rounded-lg border border-border/60 bg-card/60 p-0.5"
        >
          {enabled.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === language}
              onClick={() => setPicked(l)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11.5px] transition-colors",
                l === language
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {LANGUAGE_LABELS[l]}
            </button>
          ))}
        </fieldset>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-[11px]"
          onClick={onAddLanguage}
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
          Add language
        </Button>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5">
        <Button
          size="icon"
          variant="outline"
          className="size-8 shrink-0 rounded-full"
          disabled={!current?.ready || busy !== null}
          aria-label={current ? `Listen to ${current.name}` : "Listen"}
          onClick={() => current && void listen(current)}
        >
          {busy === `listen:${current?.id}` ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={1.75} />
          )}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Default {LANGUAGE_LABELS[language]} voice
          </span>
          <span className="truncate text-[13px] font-medium">
            {current ? current.name : "Not chosen yet"}
          </span>
          <span className="truncate text-[10.5px] text-muted-foreground">
            {current
              ? `${current.provider} · ${KIND_LABELS[current.kind]}${
                  current.missing ? ` · ${current.missing}` : ""
                } · used by Speak, Read here and agents`
              : "Pick one below with Use."}
          </span>
        </div>
        {current?.preset ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={() => onCustomize(current)}
          >
            Customize
          </Button>
        ) : current ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={() => onEdit(current.profile)}
          >
            Edit
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <fieldset
          aria-label="Show"
          className="m-0 min-w-0 flex gap-1 rounded-lg border border-border/60 bg-card/60 p-0.5"
        >
          {(
            [
              ["all", "All"],
              ["ready", "Ready"],
              ["pending", "After install"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] transition-colors",
                filter === id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <span className="text-[10.5px] text-muted-foreground">
          Preset and designed voices need no profile; Customize makes one.
        </span>
      </div>

      {error ? <ErrorLine message={error} /> : null}

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((option) => (
          <li
            key={option.id}
            className={cn(
              "flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card/60 px-3 py-2",
              option.isDefault ? "border-primary/60" : "border-border/60",
              !option.ready && "opacity-70",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0 rounded-full"
                disabled={!option.ready || busy !== null}
                aria-label={`Listen to ${option.name}`}
                onClick={() => void listen(option)}
              >
                {busy === `listen:${option.id}` ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={1.75} />
                )}
              </Button>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                {option.name}
              </span>
              {option.preset ? null : (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 shrink-0"
                    aria-label={`Edit ${option.name}`}
                    onClick={() => onEdit(option.profile)}
                  >
                    <HugeiconsIcon icon={Edit02Icon} size={11} strokeWidth={1.75} />
                  </Button>
                  {confirmDelete === option.id ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-1.5 text-[10.5px] text-destructive"
                      onClick={() => {
                        setConfirmDelete(null);
                        void act(`delete:${option.id}`, () =>
                          removeProfile(option.id),
                        );
                      }}
                    >
                      Delete?
                    </Button>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 shrink-0"
                      aria-label={`Delete ${option.name}`}
                      onClick={() => setConfirmDelete(option.id)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
                    </Button>
                  )}
                </>
              )}
            </div>
            <span className="truncate text-[10.5px] text-muted-foreground">
              {option.provider} · {KIND_LABELS[option.kind]}
              {option.downloadsOnFirstUse
                ? " · downloads the first time it reads"
                : ""}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px]",
                  option.ready
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : option.readiness.state === "unsupported"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}
              >
                {option.missing ?? (option.isDefault ? "Default" : "Ready")}
              </span>
              <span className="flex-1" />
              {option.ready && !option.isDefault ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10.5px]"
                  onClick={() =>
                    void act(`use:${option.id}`, () =>
                      setDefaultProfile(language, option.id),
                    )
                  }
                >
                  Use
                </Button>
              ) : null}
              {option.readiness.state === "install" ||
              option.readiness.state === "download" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 px-2 text-[10.5px]"
                  disabled={busy !== null}
                  onClick={() => void fix(option)}
                >
                  {busy === `fix:${option.id}` ? (
                    <Spinner className="size-3" />
                  ) : (
                    <HugeiconsIcon icon={Download04Icon} size={11} strokeWidth={1.75} />
                  )}
                  {option.readiness.state === "install" ? "Install" : "Download"}
                </Button>
              ) : null}
              {option.readiness.state === "sample" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10.5px]"
                  onClick={() => onEdit(option.profile)}
                >
                  Add a sample
                </Button>
              ) : null}
            </div>
          </li>
        ))}
        <li className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-dashed border-border/70 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-medium">
            <HugeiconsIcon icon={Mic01Icon} size={12} strokeWidth={1.75} />
            New cloned voice
          </span>
          <span className="text-[10.5px] text-muted-foreground">
            ZONOS3-Mini, OmniVoice or Chatterbox clone about ten seconds of
            speech. Record it here or import a file.
          </span>
          <div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10.5px]"
              onClick={() => onNewClone(language)}
            >
              Create
            </Button>
          </div>
        </li>
      </ul>
      {shown.length === 0 ? (
        <p className="text-[10.5px] text-muted-foreground">
          {filter === "ready"
            ? "No voice is ready in this language yet. Install a provider from the Providers tab."
            : "Every voice in this language is ready."}
        </p>
      ) : null}
    </div>
  );
}
