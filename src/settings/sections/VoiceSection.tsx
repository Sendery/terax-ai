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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cleanClip, reportOnce } from "@/modules/isolator/lib/cleanup";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setCleanVoiceSamples,
  setTtsDevice,
  setTtsIdleStopMinutes,
  ttsDeviceFor,
  TTS_IDLE_STOP_MAX,
  TTS_IDLE_STOP_MIN,
} from "@/modules/settings/store";
import {
  createProfile,
  defaultPresetVoice,
  DEVICE_LABELS,
  ENGINE_APPROX_BYTES,
  ENGINE_DESCRIPTIONS,
  ENGINE_LABELS,
  engineOf,
  engineStatusOf,
  EXPRESSIVENESS_TAGS,
  formatApproxBytes,
  formatBytes,
  formatSpeed,
  BUILTIN_VOICE_ID,
  isBuiltinVoice,
  isProfileSpeakable,
  isRunning,
  LANGUAGE_LABELS,
  measuredSpeed,
  MODEL_APPROX_BYTES,
  MODEL_DESCRIPTIONS,
  MODEL_LABELS,
  MODEL_LANGUAGES,
  MODEL_PARAMS,
  MODEL_VOICE_SOURCE,
  modelsForLanguage,
  modelsOfEngine,
  modelStatusOf,
  modelSupportsTags,
  pickJob,
  presetVoicesOf,
  PREVIEW_SENTENCES,
  previewVoice,
  sidecarVoices,
  toMono24kWav,
  TTS_ENGINES,
  TTS_LANGUAGES,
  ttsNative,
  useTtsRuntime,
  useTtsStore,
  type TtsCacheEntry,
  type TtsDevice,
  type TtsEngineId,
  type TtsLanguage,
  type TtsModelId,
  type TtsPresetVoice,
  type TtsStatus,
  type VoiceParams,
  type VoiceProfile,
} from "@/modules/tts";
import { deviceChoices } from "@/modules/tts/lib/devices";
import {
  Delete02Icon,
  Download04Icon,
  FolderOpenIcon,
  HardDriveIcon,
  PlayIcon,
  Rocket01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { CleanupCard } from "./voice/CleanupCard";
import { LanguagesCard } from "./voice/LanguagesCard";
import { RecordSample } from "./voice/RecordSample";
import {
  Card,
  ErrorLine,
  FieldLabel,
  JobLog,
  PlanWarnings,
  Row,
  type Runtime,
  StateBadge,
} from "./voice/ui";
import { VoicesGallery } from "./voice/VoicesGallery";

type VoiceTab = "voices" | "providers" | "languages" | "advanced";

export function VoiceSection() {
  const runtime = useTtsRuntime();
  const hydrate = useTtsStore((s) => s.hydrate);
  const [tab, setTab] = useState<VoiceTab>("voices");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Voice"
        description="The voices Terax reads with, where they come from, and in which languages. Everything runs on this machine and lives in one folder you can delete."
      />

      {runtime.error ? (
        <ErrorLine message={`Could not read the speech status: ${runtime.error}`} />
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as VoiceTab)}>
        <TabsList>
          <TabsTrigger value="voices">Voices</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="languages">Languages</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "voices" ? (
        <VoicesTab runtime={runtime} onAddLanguage={() => setTab("languages")} />
      ) : null}
      {tab === "providers" ? (
        <section className="flex flex-col gap-3">
          {TTS_ENGINES.map((engine) => (
            <ProviderCard key={engine} engine={engine} runtime={runtime} />
          ))}
        </section>
      ) : null}
      {tab === "languages" ? <LanguagesCard status={runtime.status} /> : null}
      {tab === "advanced" ? (
        <section className="flex flex-col gap-3">
          <RuntimeCard runtime={runtime} />
          <CleanupCard runtime={runtime} />
          <IdleStopCard />
          <StorageCard runtime={runtime} />
          <OtherWeightsCard runtime={runtime} />
        </section>
      ) : null}
    </div>
  );
}

function IdleStopCard() {
  const idleStop = usePreferencesStore((s) => s.ttsIdleStopMinutes);
  const [draft, setDraft] = useState(String(idleStop));

  useEffect(() => setDraft(String(idleStop)), [idleStop]);

  return (
    <Card title="Idle stop" icon={Rocket01Icon}>
      <Row label="Minutes">
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
              ? "Zero keeps engines loaded until you stop them."
              : "Minutes of silence before an engine is stopped and its memory freed."}
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

/** Languages any of an engine's models speaks, in catalogue order. */
function engineLanguages(engine: TtsEngineId): TtsLanguage[] {
  const models = modelsOfEngine(engine);
  return TTS_LANGUAGES.filter((language) =>
    models.some((model) => MODEL_LANGUAGES[model].includes(language)),
  );
}

const CLONING: Record<TtsEngineId, string> = {
  kokoro: "Preset voices, no cloning",
  chatterbox: "Clones a sample",
  pocket: "Preset voices, no cloning",
  omnivoice: "Clones a sample or designs a voice",
  zonos3: "Default voices or a cloned sample",
};

/**
 * One provider: what it is, whether this machine suits it, one Install that
 * brings the engine and its default model, its own device, and the speed
 * measured here once it has spoken.
 */
function ProviderCard({
  engine,
  runtime,
}: {
  engine: TtsEngineId;
  runtime: Runtime;
}) {
  const devices = usePreferencesStore((s) => s.ttsDevices);
  const speed = useTtsStore((s) => s.speed);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entry = engineStatusOf(runtime.status, engine);
  const job = pickJob(
    runtime.jobs,
    (j) =>
      j.engine === engine &&
      (j.kind === "engine-install" ||
        j.kind === "engine-remove" ||
        j.kind === "model-download"),
  );
  const device = ttsDeviceFor(devices, engine);

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
  const plan = entry?.plan ?? null;
  const unsupported = plan ? !plan.supported : false;
  const models = modelsOfEngine(engine);
  const defaultModel = models[0];
  const languages = engineLanguages(engine);
  const choices = deviceChoices(engine, plan, runtime.status?.hardware);
  const measured = measuredSpeed(speed, engine);
  const fit = unsupported
    ? { tone: "bad", label: "Not available here" }
    : plan?.device === "cpu" && engine === "omnivoice"
      ? { tone: "warn", label: "Slow here" }
      : plan
        ? { tone: "ok", label: "Suits this machine" }
        : null;
  const installBytes =
    ENGINE_APPROX_BYTES[engine] + MODEL_APPROX_BYTES[defaultModel];
  const working = !!busy || isRunning(job);

  return (
    <Card
      title={ENGINE_LABELS[engine]}
      icon={HardDriveIcon}
      subtitle={ENGINE_DESCRIPTIONS[engine]}
      action={
        <div className="flex items-center gap-1.5">
          {fit ? (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px]",
                fit.tone === "bad" && "bg-destructive/10 text-destructive",
                fit.tone === "warn" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                fit.tone === "ok" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              )}
            >
              {fit.label}
            </span>
          ) : null}
          {installed ? (
            <>
              <StateBadge ok={running} label={running ? "Running" : "Stopped"} />
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-[11px]"
                disabled={working}
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
                disabled={working}
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
              disabled={working || unsupported}
              title={unsupported ? (plan?.unsupportedReason ?? undefined) : undefined}
              onClick={() =>
                void run("install", () => ttsNative.installEngine(engine))
              }
            >
              {busy === "install" ||
              (isRunning(job) && job?.kind === "engine-install") ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon icon={Download04Icon} size={12} strokeWidth={1.75} />
              )}
              Install, {formatApproxBytes(installBytes)}
            </Button>
          )}
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10.5px] sm:grid-cols-4">
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground">Languages</dt>
          <dd className="truncate" title={languages.map((l) => LANGUAGE_LABELS[l]).join(", ")}>
            {languages.map((l) => LANGUAGE_LABELS[l]).join(", ")}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground">Voices</dt>
          <dd>{CLONING[engine]}</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground">Disk</dt>
          <dd>
            {installed
              ? `${formatBytes(entry?.sizeBytes ?? 0)} installed`
              : `About ${formatApproxBytes(installBytes)}`}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground">Speed here</dt>
          <dd>{measured ? `Measured: ${formatSpeed(measured)}` : "Not measured yet"}</dd>
        </div>
      </dl>
      {unsupported ? (
        <p className="text-[10.5px] text-muted-foreground">{plan?.unsupportedReason}</p>
      ) : null}
      {plan?.supported ? <PlanWarnings warnings={plan.warnings} /> : null}
      {plan?.supported && plan.notes.length > 0 ? (
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-2 py-1.5">
          <span className="text-[10.5px] font-medium text-foreground">
            Tuned for {runtime.status?.hardwareSummary ?? "this machine"}
          </span>
          {plan.notes.map((note) => (
            <span key={note} className="text-[10.5px] text-muted-foreground">
              {note}
            </span>
          ))}
        </div>
      ) : null}
      {choices.length > 0 ? (
        <Row label="Device">
          <Select
            value={device}
            onValueChange={(value) => void setTtsDevice(engine, value as TtsDevice)}
          >
            <SelectTrigger
              aria-label={`Compute device for ${ENGINE_LABELS[engine]}`}
              className="h-8 w-full text-[11.5px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.id} value={choice.id} className="text-[12px]">
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      ) : null}
      {running && entry?.device && entry.device !== device ? (
        <p className="text-[10.5px] text-muted-foreground">
          Running on {DEVICE_LABELS[entry.device]}. Stop and start the engine to
          switch device.
        </p>
      ) : null}
      {installed && models.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {models.map((model) => {
            const status = modelStatusOf(runtime.status, model);
            return (
              <li
                key={model}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-card/40 px-2.5 py-1.5"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[11.5px] font-medium">
                    {MODEL_LABELS[model]}
                  </span>
                  <span className="truncate text-[10.5px] text-muted-foreground">
                    {MODEL_DESCRIPTIONS[model]}
                  </span>
                </span>
                <span className="shrink-0 text-[10.5px] text-muted-foreground">
                  {status?.downloaded
                    ? formatBytes(status.sizeBytes)
                    : formatApproxBytes(MODEL_APPROX_BYTES[model])}
                </span>
                {status?.downloaded ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-[10.5px] text-muted-foreground hover:text-destructive"
                    disabled={working}
                    onClick={() =>
                      void run(model, () => ttsNative.removeModel(model))
                    }
                  >
                    Remove
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 gap-1 px-2 text-[10.5px]"
                    disabled={working}
                    onClick={() =>
                      void run(model, () => ttsNative.downloadModel(model))
                    }
                  >
                    {busy === model ? <Spinner className="size-3" /> : null}
                    Download
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {engine === "pocket" ? (
        <p className="text-[10.5px] text-muted-foreground">
          Install fetches the Spanish and English models; French, German,
          Italian and Portuguese download the first time they read.
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      <JobLog runtime={runtime} job={job} />
    </Card>
  );
}

/** Weights in the shared cache that no current model uses. */
function OtherWeightsCard({ runtime }: { runtime: Runtime }) {
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
      title="Other cached weights"
      icon={Download04Icon}
      subtitle="Downloaded by an older build or an engine Terax no longer offers. Removing them is safe."
    >
      {error ? <ErrorLine message={error} /> : null}

      {unknown.length === 0 ? (
        <p className="text-[10.5px] text-muted-foreground">Nothing to purge.</p>
      ) : null}
      {unknown.length > 0 ? (
        <div className="flex flex-col gap-1.5">
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

/** The gallery plus the editor it opens for customizing, cloning and editing. */
function VoicesTab({
  runtime,
  onAddLanguage,
}: {
  runtime: Runtime;
  onAddLanguage: () => void;
}) {
  const [editing, setEditing] = useState<VoiceProfile | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <VoicesGallery
        onChanged={() => void runtime.refresh()}
        onEdit={(profile) => setEditing(profile)}
        onCustomize={(option) =>
          setEditing(
            createProfile({
              name: option.name,
              model: option.model,
              language: option.language,
              voice: option.profile.voice,
            }),
          )
        }
        onNewClone={(language) => {
          const model = (["zonos3-mini", "omnivoice", "chatterbox-multilingual"] as const).find(
            (m) => MODEL_LANGUAGES[m].includes(language),
          );
          if (!model) return;
          setEditing(
            createProfile({
              name: "My voice",
              model,
              language,
              voice: null,
            }),
          );
        }}
        onAddLanguage={onAddLanguage}
      />
      <VoiceEditor
        profile={editing}
        status={runtime.status}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

/** The voice picker's value for "clone my own sample". */
const SAMPLE_CHOICE = "__sample__";

/** A Kokoro preset id, or a comma blend of them (`af_heart,bf_emma`). */
const KOKORO_VOICE_ID = /^[a-z][fm]_[a-z]+(\s*,\s*[a-z][fm]_[a-z]+)*$/;

function defaultVoiceIdFor(
  model: TtsModelId,
  language: TtsLanguage,
  draft: { voice: string | null; sampleId: string | null },
): string | null {
  const presets = presetVoicesOf(model, language);
  const fallback = defaultPresetVoice(model, language);
  if (MODEL_VOICE_SOURCE[model] === "preset") {
    // A Kokoro id typed by hand (or a blend) stays; another model's preset
    // does not carry over.
    if (model === "kokoro-82m" && draft.voice && KOKORO_VOICE_ID.test(draft.voice)) {
      return draft.voice;
    }
    return presets.some((p) => p.id === draft.voice) ? draft.voice : fallback;
  }
  if (draft.sampleId && !isBuiltinVoice(model, draft.voice, language)) {
    return null;
  }
  return presets.some((p) => p.id === draft.voice) ? draft.voice : fallback;
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
  const [cleaningSample, setCleaningSample] = useState(false);
  const cleanSamples = usePreferencesStore((s) => s.cleanVoiceSamples);
  const [previewing, setPreviewing] = useState(false);
  const [sentence, setSentence] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(profile);
    setError(null);
    setPresets(null);
    setSentence(profile ? PREVIEW_SENTENCES[profile.language] : "");
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
      voice: defaultVoiceIdFor(nextModel, language, draft),
    });
  };

  const changeModel = (next: TtsModelId) => {
    const voice = defaultVoiceIdFor(next, draft.language, draft);
    patch({
      model: next,
      voice,
      sampleId:
        MODEL_VOICE_SOURCE[next] === "preset" ||
        isBuiltinVoice(next, voice, draft.language)
          ? null
          : draft.sampleId,
      params: {},
      style: modelSupportsTags(next)
        ? draft.style
        : { ...draft.style, tags: undefined },
    });
  };

  const importSample = async (file: Blob, name: string) => {
    setImporting(true);
    setError(null);
    try {
      const converted = await toMono24kWav(file);
      const prefs = usePreferencesStore.getState();
      setCleaningSample(prefs.cleanVoiceSamples);
      const { bytes: wav } = await cleanClip(
        prefs.cleanVoiceSamples,
        converted,
        prefs.isolatorDevice,
        (reason) => reportOnce(reason, (m) => toast.warning(m)),
      );
      setCleaningSample(false);
      const imported = await ttsNative.sampleImport(name, wav);
      patch({ sampleId: imported.sampleId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setCleaningSample(false);
    }
  };

  const preview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      await previewVoice(createProfile({ ...draft, name: draft.name }), sentence);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const knownPresets = presetVoicesOf(draft.model, draft.language);
  // Kokoro's own list comes from the running engine (and takes blends typed by
  // hand); the other preset models are fully described by the static list.
  // Every preset is listed from the catalogue, so nothing has to run first; a
  // running Kokoro adds any voice its weights carry beyond the catalogue.
  const presetOptions = [
    ...knownPresets,
    ...(presets ?? [])
      .filter((v) => v.language === draft.language || v.language === "other")
      .filter((v) => !knownPresets.some((k) => k.id === v.id))
      .map((v) => ({ id: v.id, label: v.label || v.id })),
  ];
  const customKokoro =
    draft.model === "kokoro-82m" &&
    !!draft.voice &&
    !presetOptions.some((v) => v.id === draft.voice);
  const usesBuiltin = isBuiltinVoice(draft.model, draft.voice, draft.language);
  const ownVoices = MODEL_VOICE_SOURCE[draft.model] === "clone" ? knownPresets : [];
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
              <Select
                  value={customKokoro ? "" : (draft.voice ?? "")}
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
              {draft.model === "kokoro-82m" ? (
                <>
                  <Input
                    aria-label="Kokoro voice id or blend"
                    value={draft.voice ?? ""}
                    placeholder="af_heart,bf_emma"
                    spellCheck={false}
                    onChange={(e) => patch({ voice: e.target.value })}
                    className="h-8 font-mono text-[11.5px]"
                  />
                  <span className="text-[10.5px] text-muted-foreground">
                    Or type a voice id; comma-separated ids blend voices.
                  </span>
                </>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {ownVoices.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="voice-source">Voice</FieldLabel>
                  <Select
                    value={usesBuiltin && draft.voice ? draft.voice : SAMPLE_CHOICE}
                    onValueChange={(v) =>
                      patch(
                        v === SAMPLE_CHOICE
                          ? { voice: null }
                          : { voice: v, sampleId: null },
                      )
                    }
                  >
                    <SelectTrigger
                      id="voice-source"
                      className="h-8 w-full text-[11.5px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ownVoices.map((v) => (
                        <SelectItem key={v.id} value={v.id} className="text-[12px]">
                          {v.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={SAMPLE_CHOICE} className="text-[12px]">
                        Cloned from a sample
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-[10.5px] text-muted-foreground">
                    {!usesBuiltin
                      ? "Your own recording, cloned by the model."
                      : draft.voice === BUILTIN_VOICE_ID
                        ? `The speaker ${MODEL_LABELS[draft.model]} carries in its own weights. Nothing to record.`
                        : `A voice ${MODEL_LABELS[draft.model]} speaks without a sample. Nothing to record.`}
                  </span>
                </div>
              ) : null}
              {usesBuiltin ? null : (
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
                  {cleaningSample
                    ? "Cleaning"
                    : draft.sampleId
                      ? "Replace"
                      : "Import"}
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
                  if (file) void importSample(file, file.name);
                }}
              />
              <RecordSample
                language={draft.language}
                disabled={importing}
                onRecorded={(blob) =>
                  void importSample(
                    blob,
                    `recording-${new Date().toISOString().slice(0, 19)}.webm`,
                  )
                }
                onError={setError}
              />
              <span className="text-[10.5px] text-muted-foreground">
                About ten seconds of clean speech in{" "}
                {LANGUAGE_LABELS[draft.language]}. Converted to 24 kHz mono
                before it is stored.
              </span>
              <label className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex flex-col">
                  <span>Remove background noise first</span>
                  <span className="text-[10.5px] text-muted-foreground">
                    The Voice Isolator cleans the sample before it is stored,
                    so the clone does not copy the room. Takes a minute or two
                    on a CPU.
                  </span>
                </span>
                <Switch
                  checked={cleanSamples}
                  disabled={importing}
                  onCheckedChange={(checked) => void setCleanVoiceSamples(checked)}
                  aria-label="Remove background noise from voice samples"
                />
              </label>
            </div>
              )}
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

          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="voice-preview-sentence">Try it</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id="voice-preview-sentence"
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                className="h-8 text-[11.5px]"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1.5 px-2 text-[11px]"
                disabled={previewing || !isProfileSpeakable(createProfile({ ...draft }))}
                onClick={() => void preview()}
              >
                {previewing ? (
                  <Spinner className="size-3" />
                ) : (
                  <HugeiconsIcon icon={PlayIcon} size={12} strokeWidth={1.75} />
                )}
                Listen
              </Button>
            </div>
            <span className="text-[10.5px] text-muted-foreground">
              Plays with these settings before saving. The provider and model
              must be installed.
            </span>
          </div>

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
