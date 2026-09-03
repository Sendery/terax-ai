import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setTtsDefaultLanguage,
  setTtsDevice,
  setTtsIdleStopMinutes,
  TTS_IDLE_STOP_MAX,
  TTS_IDLE_STOP_MIN,
} from "@/modules/settings/store";
import {
  createProfile,
  DEVICE_LABELS,
  ENGINE_APPROX_BYTES,
  ENGINE_DESCRIPTIONS,
  ENGINE_LABELS,
  engineOf,
  engineStatusOf,
  EXPRESSIVENESS_TAGS,
  formatApproxBytes,
  formatBytes,
  isProfileSpeakable,
  isRunning,
  KOKORO_PRESET_VOICES,
  LANGUAGE_LABELS,
  MODEL_APPROX_BYTES,
  MODEL_DESCRIPTIONS,
  MODEL_LABELS,
  MODEL_LANGUAGES,
  MODEL_PARAMS,
  MODEL_VOICE_SOURCE,
  modelsForLanguage,
  modelStatusOf,
  modelSupportsTags,
  pickJob,
  previewVoice,
  sidecarVoices,
  toMono24kWav,
  TTS_DEVICES,
  TTS_ENGINES,
  TTS_LANGUAGES,
  TTS_MODELS,
  ttsNative,
  useTtsRuntime,
  useTtsStore,
  type TtsCacheEntry,
  type TtsDevice,
  type TtsEngineId,
  type TtsJob,
  type TtsLanguage,
  type TtsModelId,
  type TtsPresetVoice,
  type TtsStatus,
  type VoiceParams,
  type VoiceProfile,
} from "@/modules/tts";
import {
  Add01Icon,
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Download04Icon,
  Edit02Icon,
  FolderOpenIcon,
  HardDriveIcon,
  PlayIcon,
  Rocket01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { VoiceBlock } from "./VoiceBlock";

type Runtime = ReturnType<typeof useTtsRuntime>;

export function VoiceSection() {
  const runtime = useTtsRuntime();
  const hydrate = useTtsStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Voice"
        description="Speech in and speech out. Everything under Speech output runs on this machine and lives in one folder you can delete."
      />

      <VoiceBlock />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <FieldLabel>Speech output</FieldLabel>
          <span className="text-[10.5px] text-muted-foreground">
            Install an engine, download a model, then define the voices Terax
            reads with.
          </span>
        </div>

        {runtime.error ? (
          <ErrorLine
            message={`Could not read the speech status: ${runtime.error}`}
          />
        ) : null}

        <DefaultsCard />
        <RuntimeCard runtime={runtime} />
        {TTS_ENGINES.map((engine) => (
          <EngineCard key={engine} engine={engine} runtime={runtime} />
        ))}
        <ModelsCard runtime={runtime} />
        <VoicesCard status={runtime.status} />
        <StorageCard runtime={runtime} />
      </section>
    </div>
  );
}

function DefaultsCard() {
  const language = usePreferencesStore((s) => s.ttsDefaultLanguage);
  const idleStop = usePreferencesStore((s) => s.ttsIdleStopMinutes);
  const [draft, setDraft] = useState(String(idleStop));

  useEffect(() => setDraft(String(idleStop)), [idleStop]);

  return (
    <Card title="Defaults" icon={Rocket01Icon}>
      <Row label="Language">
        <Select
          value={language}
          onValueChange={(value) =>
            void setTtsDefaultLanguage(value as TtsLanguage)
          }
        >
          <SelectTrigger
            aria-label="Default language for read aloud"
            className="h-8 w-full text-[11.5px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TTS_LANGUAGES.map((id) => (
              <SelectItem key={id} value={id} className="text-[12px]">
                {LANGUAGE_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Idle stop">
        <div className="flex flex-1 items-center gap-2">
          <Input
            type="number"
            min={TTS_IDLE_STOP_MIN}
            max={TTS_IDLE_STOP_MAX}
            value={draft}
            aria-label="Minutes of silence before the speech engine stops"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void setTtsIdleStopMinutes(Number(draft))}
            className="h-8 w-20 text-[11.5px]"
          />
          <span className="text-[10.5px] text-muted-foreground">
            {idleStop === 0
              ? "Minutes. Zero keeps the engine loaded until you stop it."
              : `Minutes of silence before the engine is stopped and its memory freed.`}
          </span>
        </div>
      </Row>
    </Card>
  );
}

function RuntimeCard({ runtime }: { runtime: Runtime }) {
  const [busy, setBusy] = useState(false);
  const info = runtime.status?.runtime;
  const job = pickJob(runtime.jobs, (j) => j.kind === "runtime");

  const install = async () => {
    setBusy(true);
    try {
      await ttsNative.installRuntime();
      await runtime.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Runtime"
      icon={Rocket01Icon}
      subtitle="A private Python and uv, downloaded once and used by every engine."
      action={
        info?.installed ? (
          <StateBadge ok label="Installed" />
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            disabled={busy || isRunning(job) || runtime.loading}
            onClick={() => void install()}
          >
            {busy || isRunning(job) ? (
              <Spinner className="size-3" />
            ) : (
              <HugeiconsIcon icon={Download04Icon} size={12} strokeWidth={1.75} />
            )}
            Install runtime
          </Button>
        )
      }
    >
      {info?.installed ? (
        <p className="text-[10.5px] text-muted-foreground">
          uv {info.uvVersion ?? "unknown"} with Python{" "}
          {info.pythonVersion ?? "unknown"}.
        </p>
      ) : (
        <p className="text-[10.5px] text-muted-foreground">
          Not installed. About 120 MB is downloaded into the Terax data folder;
          nothing outside it is touched.
        </p>
      )}
      <JobLog runtime={runtime} job={job} />
    </Card>
  );
}

function EngineCard({
  engine,
  runtime,
}: {
  engine: TtsEngineId;
  runtime: Runtime;
}) {
  const device = usePreferencesStore((s) => s.ttsDevice);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entry = engineStatusOf(runtime.status, engine);
  const job = pickJob(
    runtime.jobs,
    (j) =>
      j.engine === engine &&
      (j.kind === "engine-install" || j.kind === "engine-remove"),
  );

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      await runtime.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const installed = entry?.installed ?? false;
  const running = entry?.running ?? false;

  return (
    <Card
      title={ENGINE_LABELS[engine]}
      icon={HardDriveIcon}
      subtitle={ENGINE_DESCRIPTIONS[engine]}
      action={
        <div className="flex items-center gap-1.5">
          {installed ? (
            <StateBadge ok={running} label={running ? "Running" : "Stopped"} />
          ) : null}
          {installed ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-[11px]"
                disabled={!!busy || isRunning(job)}
                onClick={() =>
                  void run(
                    running ? "stop" : "start",
                    running
                      ? () => ttsNative.stop(engine)
                      : () => ttsNative.start(engine, device),
                  )
                }
              >
                {busy === "start" || busy === "stop" ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon
                    icon={running ? StopIcon : PlayIcon}
                    size={12}
                    strokeWidth={1.75}
                  />
                )}
                {running ? "Stop" : "Start"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                disabled={!!busy || isRunning(job)}
                onClick={() =>
                  void run("remove", () => ttsNative.removeEngine(engine))
                }
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
                Remove
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2 text-[11px]"
              disabled={!!busy || isRunning(job)}
              onClick={() =>
                void run("install", () => ttsNative.installEngine(engine))
              }
            >
              {busy === "install" ||
              (isRunning(job) && job?.kind === "engine-install") ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon
                  icon={Download04Icon}
                  size={12}
                  strokeWidth={1.75}
                />
              )}
              Install
            </Button>
          )}
        </div>
      }
    >
      <p className="text-[10.5px] text-muted-foreground">
        {installed
          ? `Installed, ${formatBytes(entry?.sizeBytes ?? 0)} on disk.`
          : `Not installed. The install needs about ${formatBytes(
              ENGINE_APPROX_BYTES[engine],
            )} and pulls the runtime first if it is missing.`}
      </p>
      <Row label="Device">
        <Select
          value={device}
          onValueChange={(value) => void setTtsDevice(value as TtsDevice)}
        >
          <SelectTrigger
            aria-label={`Compute device for ${ENGINE_LABELS[engine]}`}
            className="h-8 w-full text-[11.5px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TTS_DEVICES.map((id) => (
              <SelectItem key={id} value={id} className="text-[12px]">
                {DEVICE_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      {running && entry?.device && entry.device !== device ? (
        <p className="text-[10.5px] text-muted-foreground">
          Running on {DEVICE_LABELS[entry.device]}. Stop and start the engine to
          switch device.
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      <JobLog runtime={runtime} job={job} />
    </Card>
  );
}

function ModelsCard({ runtime }: { runtime: Runtime }) {
  const [cache, setCache] = useState<TtsCacheEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCache = useCallback(async () => {
    try {
      setCache(await ttsNative.modelsList());
    } catch {
      setCache([]);
    }
  }, []);

  useEffect(() => {
    void loadCache();
  }, [loadCache]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await runtime.refresh();
      await loadCache();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const unknown = (cache ?? []).filter((entry) => entry.model === null);

  return (
    <Card
      title="Models"
      icon={Download04Icon}
      subtitle="Weights are shared between engines and stored in the same folder."
    >
      <ul className="flex flex-col gap-1.5">
        {TTS_MODELS.map((model) => {
          const engine = engineOf(model);
          const status = modelStatusOf(runtime.status, model);
          const engineInstalled =
            engineStatusOf(runtime.status, engine)?.installed ?? false;
          const job = pickJob(
            runtime.jobs,
            (j) => j.kind === "model-download" && j.model === model,
          );
          return (
            <li
              key={model}
              className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
            >
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium">
                      {MODEL_LABELS[model]}
                    </span>
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[9.5px] font-normal"
                    >
                      {ENGINE_LABELS[engine]}
                    </Badge>
                    {status?.downloaded ? (
                      <StateBadge ok label="Downloaded" />
                    ) : null}
                  </div>
                  <span className="text-[10.5px] text-muted-foreground">
                    {MODEL_DESCRIPTIONS[model]}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground/80">
                    {MODEL_LANGUAGES[model]
                      .map((l) => LANGUAGE_LABELS[l])
                      .join(", ")}
                    {" · "}
                    {status?.downloaded
                      ? formatBytes(status.sizeBytes)
                      : formatApproxBytes(MODEL_APPROX_BYTES[model])}
                    {" · "}
                    {MODEL_VOICE_SOURCE[model] === "preset"
                      ? "preset voices"
                      : "cloned from a sample"}
                  </span>
                </div>
                {status?.downloaded ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                    disabled={busy === model}
                    onClick={() =>
                      void run(model, () => ttsNative.removeModel(model))
                    }
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={12}
                      strokeWidth={1.75}
                    />
                    Remove
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
                    disabled={
                      !engineInstalled || busy === model || isRunning(job)
                    }
                    title={
                      engineInstalled
                        ? undefined
                        : `Install ${ENGINE_LABELS[engine]} first`
                    }
                    onClick={() =>
                      void run(model, () => ttsNative.downloadModel(model))
                    }
                  >
                    {busy === model || isRunning(job) ? (
                      <Spinner className="size-3" />
                    ) : (
                      <HugeiconsIcon
                        icon={Download04Icon}
                        size={12}
                        strokeWidth={1.75}
                      />
                    )}
                    Download
                  </Button>
                )}
              </div>
              {!engineInstalled && !status?.downloaded ? (
                <p className="text-[10.5px] text-muted-foreground/80">
                  Needs the {ENGINE_LABELS[engine]} engine.
                </p>
              ) : null}
              <JobLog runtime={runtime} job={job} />
            </li>
          );
        })}
      </ul>

      {error ? <ErrorLine message={error} /> : null}

      {unknown.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Other cached weights</FieldLabel>
          <span className="text-[10.5px] text-muted-foreground">
            Downloaded by an older build or an engine Terax no longer offers.
            Removing them is safe.
          </span>
          <ul className="flex flex-col gap-1">
            {unknown.map((entry) => (
              <li
                key={entry.dirName}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-card/40 px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]">
                  {entry.repo || entry.dirName}
                </span>
                <span className="shrink-0 text-[10.5px] text-muted-foreground">
                  {formatBytes(entry.sizeBytes)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 shrink-0 px-2 text-[10.5px] text-muted-foreground hover:text-destructive"
                  disabled={busy === entry.dirName}
                  onClick={() =>
                    void run(entry.dirName, () =>
                      ttsNative.modelsPurge(entry.dirName),
                    )
                  }
                >
                  Purge
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function VoicesCard({ status }: { status: TtsStatus | null }) {
  const profiles = useTtsStore((s) => s.profiles);
  const defaults = useTtsStore((s) => s.defaults);
  const hydrated = useTtsStore((s) => s.hydrated);
  const setDefaultProfile = useTtsStore((s) => s.setDefaultProfile);
  const removeProfile = useTtsStore((s) => s.removeProfile);
  const [editing, setEditing] = useState<VoiceProfile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultLanguage = usePreferencesStore((s) => s.ttsDefaultLanguage);

  const preview = async (profile: VoiceProfile) => {
    setError(null);
    try {
      await previewVoice(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card
      title="Voices"
      icon={PlayIcon}
      subtitle="One default per language decides what read aloud uses."
      action={
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          onClick={() =>
            setEditing(
              createProfile({
                name: "New voice",
                language: defaultLanguage,
                model: "kokoro-82m",
                voice: KOKORO_PRESET_VOICES[defaultLanguage][0]?.id ?? null,
              }),
            )
          }
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
          New voice
        </Button>
      }
    >
      {error ? <ErrorLine message={error} /> : null}

      {TTS_LANGUAGES.map((language) => {
        const group = profiles.filter((p) => p.language === language);
        return (
          <div key={language} className="flex flex-col gap-1.5">
            <FieldLabel>{LANGUAGE_LABELS[language]}</FieldLabel>
            {group.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/60 bg-card/30 px-3 py-3 text-center text-[10.5px] text-muted-foreground">
                {hydrated
                  ? `No ${LANGUAGE_LABELS[language]} voice yet. Add one to read aloud in ${LANGUAGE_LABELS[language]}.`
                  : "Loading voices…"}
              </p>
            ) : (
              <RadioGroup
                value={defaults[language] ?? ""}
                onValueChange={(value) =>
                  void setDefaultProfile(language, value || null)
                }
                aria-label={`Default ${LANGUAGE_LABELS[language]} voice`}
                className="flex flex-col gap-1"
              >
                {group.map((profile) => (
                  <div
                    key={profile.id}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
                  >
                    <RadioGroupItem
                      value={profile.id}
                      id={`default-${profile.id}`}
                      aria-label={`Make ${profile.name} the default ${LANGUAGE_LABELS[language]} voice`}
                    />
                    <label
                      htmlFor={`default-${profile.id}`}
                      className="flex min-w-0 flex-1 cursor-pointer flex-col"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] font-medium">
                          {profile.name}
                        </span>
                        {defaults[language] === profile.id ? (
                          <Badge
                            variant="secondary"
                            className="h-4 px-1 text-[9.5px] font-normal"
                          >
                            Default
                          </Badge>
                        ) : null}
                        {isProfileSpeakable(profile) ? null : (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[9.5px] font-normal text-destructive"
                          >
                            Incomplete
                          </Badge>
                        )}
                      </span>
                      <span className="truncate text-[10.5px] text-muted-foreground">
                        {MODEL_LABELS[profile.model]}
                        {profile.voice ? ` · ${profile.voice}` : ""}
                        {profile.sampleId ? " · cloned sample" : ""}
                        {profile.style.tags?.length
                          ? ` · ${profile.style.tags.length} tags`
                          : ""}
                      </span>
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
                      disabled={
                        !isProfileSpeakable(profile) ||
                        !modelStatusOf(status, profile.model)?.downloaded
                      }
                      title={
                        modelStatusOf(status, profile.model)?.downloaded
                          ? "Speak a short sample"
                          : `${MODEL_LABELS[profile.model]} is not downloaded`
                      }
                      onClick={() => void preview(profile)}
                    >
                      <HugeiconsIcon
                        icon={PlayIcon}
                        size={12}
                        strokeWidth={1.75}
                      />
                      Preview
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      onClick={() => setEditing(profile)}
                      aria-label={`Edit ${profile.name}`}
                    >
                      <HugeiconsIcon
                        icon={Edit02Icon}
                        size={12}
                        strokeWidth={1.75}
                      />
                    </Button>
                    {confirmDelete === profile.id ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2 text-[11px] text-destructive"
                        onClick={() => {
                          setConfirmDelete(null);
                          void removeProfile(profile.id);
                        }}
                      >
                        Confirm
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDelete(profile.id)}
                        aria-label={`Delete ${profile.name}`}
                      >
                        <HugeiconsIcon
                          icon={Delete02Icon}
                          size={12}
                          strokeWidth={1.75}
                        />
                      </Button>
                    )}
                  </div>
                ))}
              </RadioGroup>
            )}
          </div>
        );
      })}

      <VoiceEditor
        profile={editing}
        status={status}
        onClose={() => setEditing(null)}
      />
    </Card>
  );
}

function VoiceEditor({
  profile,
  status,
  onClose,
}: {
  profile: VoiceProfile | null;
  status: TtsStatus | null;
  onClose: () => void;
}) {
  const saveProfile = useTtsStore((s) => s.saveProfile);
  const [draft, setDraft] = useState<VoiceProfile | null>(profile);
  const [presets, setPresets] = useState<TtsPresetVoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(profile);
    setError(null);
    setPresets(null);
  }, [profile]);

  const model = draft?.model ?? "kokoro-82m";
  const engine = engineOf(model);
  const entry = engineStatusOf(status, engine);
  const port = entry?.running ? entry.port : null;
  const token = entry?.running ? entry.token : null;
  const wantsPreset = MODEL_VOICE_SOURCE[model] === "preset";

  useEffect(() => {
    if (!wantsPreset || port === null || !token) return;
    let cancelled = false;
    void sidecarVoices({ port, token }, model)
      .then((list) => {
        if (!cancelled) setPresets(list);
      })
      .catch(() => {
        if (!cancelled) setPresets(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wantsPreset, port, token, model]);

  if (!draft) return null;

  const patch = (next: Partial<VoiceProfile>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  const changeLanguage = (language: TtsLanguage) => {
    const allowed = modelsForLanguage(language);
    const nextModel = allowed.includes(draft.model) ? draft.model : allowed[0];
    patch({
      language,
      model: nextModel,
      voice:
        MODEL_VOICE_SOURCE[nextModel] === "preset"
          ? (KOKORO_PRESET_VOICES[language][0]?.id ?? null)
          : null,
    });
  };

  const changeModel = (next: TtsModelId) => {
    patch({
      model: next,
      voice:
        MODEL_VOICE_SOURCE[next] === "preset"
          ? (draft.voice ?? KOKORO_PRESET_VOICES[draft.language][0]?.id ?? null)
          : null,
      sampleId: MODEL_VOICE_SOURCE[next] === "preset" ? null : draft.sampleId,
      params: {},
      style: modelSupportsTags(next)
        ? draft.style
        : { ...draft.style, tags: undefined },
    });
  };

  const importSample = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      const wav = await toMono24kWav(file);
      const imported = await ttsNative.sampleImport(file.name, wav);
      patch({ sampleId: imported.sampleId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const presetOptions =
    presets && presets.length > 0
      ? presets
          .filter((v) => v.language === draft.language || v.language === "other")
          .map((v) => ({ id: v.id, label: v.label || v.id }))
      : null;
  const knownPresets = KOKORO_PRESET_VOICES[draft.language];
  const tagged = modelSupportsTags(draft.model);
  const params = MODEL_PARAMS[draft.model];

  const save = () => {
    void saveProfile(createProfile({ ...draft, name: draft.name }));
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[14px]">
            {profile && profile.name !== "New voice" ? "Edit voice" : "New voice"}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            A voice is a model, a language and how it should sound.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-2 flex max-h-[calc(100vh-16rem)] min-w-0 flex-col gap-3 overflow-y-auto px-2">
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <FieldLabel htmlFor="voice-name">Name</FieldLabel>
              <Input
                id="voice-name"
                value={draft.name}
                maxLength={60}
                onChange={(e) => patch({ name: e.target.value })}
                className="h-8 text-[11.5px]"
              />
            </div>
            <div className="flex w-36 shrink-0 flex-col gap-1">
              <FieldLabel htmlFor="voice-language">Language</FieldLabel>
              <Select
                value={draft.language}
                onValueChange={(v) => changeLanguage(v as TtsLanguage)}
              >
                <SelectTrigger
                  id="voice-language"
                  className="h-8 w-full text-[11.5px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TTS_LANGUAGES.map((id) => (
                    <SelectItem key={id} value={id} className="text-[12px]">
                      {LANGUAGE_LABELS[id]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="voice-model">Model</FieldLabel>
            <Select
              value={draft.model}
              onValueChange={(v) => changeModel(v as TtsModelId)}
            >
              <SelectTrigger id="voice-model" className="h-8 w-full text-[11.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelsForLanguage(draft.language).map((id) => (
                  <SelectItem key={id} value={id} className="text-[12px]">
                    {MODEL_LABELS[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[10.5px] text-muted-foreground">
              {MODEL_DESCRIPTIONS[draft.model]}
            </span>
          </div>

          {wantsPreset ? (
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="voice-preset">Preset voice</FieldLabel>
              {presetOptions ? (
                <Select
                  value={draft.voice ?? ""}
                  onValueChange={(v) => patch({ voice: v })}
                >
                  <SelectTrigger
                    id="voice-preset"
                    className="h-8 w-full text-[11.5px]"
                  >
                    <SelectValue placeholder="Pick a preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {presetOptions.map((v) => (
                      <SelectItem key={v.id} value={v.id} className="text-[12px]">
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <>
                  <Input
                    id="voice-preset"
                    list="voice-preset-options"
                    value={draft.voice ?? ""}
                    placeholder={knownPresets[0]?.id ?? "af_heart"}
                    spellCheck={false}
                    onChange={(e) => patch({ voice: e.target.value })}
                    className="h-8 font-mono text-[11.5px]"
                  />
                  <datalist id="voice-preset-options">
                    {knownPresets.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </datalist>
                  <span className="text-[10.5px] text-muted-foreground">
                    Start the engine to load its own list. Comma-separated ids
                    blend two voices.
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <FieldLabel>Voice sample</FieldLabel>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
                  {draft.sampleId ?? "No sample imported yet"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
                  disabled={importing}
                  onClick={() => fileRef.current?.click()}
                >
                  {importing ? <Spinner className="size-3" /> : null}
                  {draft.sampleId ? "Replace" : "Import"}
                </Button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                tabIndex={-1}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void importSample(file);
                }}
              />
              <span className="text-[10.5px] text-muted-foreground">
                About ten seconds of clean speech in{" "}
                {LANGUAGE_LABELS[draft.language]}. Converted to 24 kHz mono
                before it is stored.
              </span>
            </div>
          )}

          {params.length > 0 ? (
            <div className="flex flex-col gap-2">
              <FieldLabel>Synthesis</FieldLabel>
              {params.map((spec) => {
                const value = draft.params[spec.name] ?? spec.default;
                return (
                  <div key={spec.name} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px]">{spec.label}</span>
                      <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
                        {value.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      value={[value]}
                      min={spec.min}
                      max={spec.max}
                      step={spec.step}
                      aria-label={spec.label}
                      onValueChange={([next]) =>
                        patch({
                          params: {
                            ...draft.params,
                            [spec.name]: next,
                          } as VoiceParams,
                        })
                      }
                    />
                    <span className="text-[10.5px] text-muted-foreground">
                      {spec.hint}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="voice-persona">Persona</FieldLabel>
            <Input
              id="voice-persona"
              value={draft.style.persona ?? ""}
              placeholder="A calm narrator"
              onChange={(e) =>
                patch({ style: { ...draft.style, persona: e.target.value } })
              }
              className="h-8 text-[11.5px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="voice-instructions">Instructions</FieldLabel>
            <Textarea
              id="voice-instructions"
              value={draft.style.instructions ?? ""}
              placeholder="Read code slowly and spell out symbols."
              rows={3}
              onChange={(e) =>
                patch({
                  style: { ...draft.style, instructions: e.target.value },
                })
              }
              className="text-[11.5px]"
            />
            <span className="text-[10.5px] text-muted-foreground">
              Guidance for agents that write the text this voice reads. It is
              never spoken.
            </span>
          </div>

          {tagged ? (
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Expressiveness tags</FieldLabel>
              <span className="text-[10.5px] text-muted-foreground">
                Tags this voice may use. Only laugh, cough and chuckle are
                documented by the model; the rest vary in quality.
              </span>
              <div className="flex flex-wrap gap-1">
                {EXPRESSIVENESS_TAGS.map((tag) => {
                  const active = draft.style.tags?.includes(tag.tag) ?? false;
                  return (
                    <button
                      key={tag.tag}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const current = draft.style.tags ?? [];
                        patch({
                          style: {
                            ...draft.style,
                            tags: active
                              ? current.filter((t) => t !== tag.tag)
                              : [...current, tag.tag],
                          },
                        });
                      }}
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                        active
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-border/60 bg-card/60 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {active ? "✓ " : ""}
                      {tag.label}
                      {tag.documented ? "" : " *"}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {error ? <ErrorLine message={error} /> : null}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={draft.name.trim().length === 0}
            onClick={save}
          >
            Save voice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StorageCard({ runtime }: { runtime: Runtime }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usage = runtime.status?.diskUsageBytes ?? 0;
  const job = pickJob(runtime.jobs, (j) => j.kind === "purge");

  const purge = async () => {
    setBusy(true);
    setError(null);
    try {
      await ttsNative.purgeAll();
      await runtime.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Storage"
      icon={HardDriveIcon}
      subtitle="Everything speech output writes lives in one folder."
      action={
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-[11px]"
            onClick={() => void ttsNative.revealDir("root")}
          >
            <HugeiconsIcon icon={FolderOpenIcon} size={12} strokeWidth={1.75} />
            Reveal folder
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                disabled={busy || isRunning(job)}
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
                Purge everything
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-[14px]">
                  Delete every speech file?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-[11.5px]">
                  This stops the engines and removes the runtime, the engines,
                  the downloaded models and the imported samples
                  ({formatBytes(usage)}). Your voice profiles stay, so they will
                  need their model downloaded again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-7 px-2 text-[11px]">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className="h-7 px-2 text-[11px]"
                  onClick={() => void purge()}
                >
                  Purge everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      }
    >
      <p className="text-[10.5px] text-muted-foreground">
        {usage > 0
          ? `${formatBytes(usage)} used by the runtime, engines, models and samples.`
          : "Nothing installed yet, so no disk is used."}
      </p>
      {error ? <ErrorLine message={error} /> : null}
      <JobLog runtime={runtime} job={job} />
    </Card>
  );
}

function JobLog({ runtime, job }: { runtime: Runtime; job: TtsJob | null }) {
  if (!job) return null;
  const log = runtime.logs[job.id];
  const running = job.state === "running";
  if (!running && !log) return null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          {running ? <Spinner className="size-3" /> : null}
          {running
            ? "Working…"
            : job.state === "done"
              ? "Finished."
              : job.state === "cancelled"
                ? "Cancelled."
                : `Failed with code ${job.exitCode ?? "unknown"}.`}
        </span>
        <div className="flex-1" />
        {running ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1.5 px-2 text-[10.5px]"
            onClick={() => void ttsNative.jobCancel(job.id)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10.5px]"
            onClick={() => runtime.forgetJobLog(job.id)}
          >
            Clear log
          </Button>
        )}
      </div>
      {log ? (
        <pre className="max-h-40 min-w-0 overflow-auto rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed whitespace-pre">
          {log}
        </pre>
      ) : null}
    </div>
  );
}

function Card({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: typeof HardDriveIcon;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <HugeiconsIcon
          icon={icon}
          size={15}
          strokeWidth={1.5}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12.5px] font-medium">{title}</span>
          {subtitle ? (
            <span className="text-[10.5px] text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[11px] tracking-tight text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

const FIELD_LABEL_CLASS =
  "text-[11px] font-medium tracking-tight text-muted-foreground";

/** A heading with no control behind it must not render as a `<label>`. */
function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  if (!htmlFor) {
    return <span className={FIELD_LABEL_CLASS}>{children}</span>;
  }
  return (
    <label htmlFor={htmlFor} className={FIELD_LABEL_CLASS}>
      {children}
    </label>
  );
}

function StateBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px]",
        ok
          ? "border-border/60 bg-card text-foreground"
          : "border-border/50 bg-card/50 text-muted-foreground",
      )}
    >
      <HugeiconsIcon
        icon={ok ? CheckmarkCircle02Icon : StopIcon}
        size={10}
        strokeWidth={2}
      />
      {label}
    </span>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="flex min-w-0 items-start gap-1.5 text-[10.5px] text-destructive">
      <HugeiconsIcon
        icon={AlertCircleIcon}
        size={11}
        strokeWidth={2}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}
