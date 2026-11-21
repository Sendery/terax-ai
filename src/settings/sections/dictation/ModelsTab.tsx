import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  STT_PROVIDER_LABELS,
  WHISPERCPP_DEFAULT_BASE_URL,
  type SttProvider,
} from "@/modules/ai/config";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setGroqSttModel,
  setSttDevice,
  setSttProvider,
  setWhispercppBaseURL,
} from "@/modules/settings/store";
import {
  STT_ENGINE_APPROX_BYTES,
  STT_ENGINE_LABELS,
  STT_MODEL_APPROX_BYTES,
  STT_MODEL_ENGINE,
  STT_MODEL_LABELS,
  STT_TIERS,
  type SttTier,
} from "@/modules/stt/lib/catalog";
import { forgetWarmTranscribers, formatSttSpeed } from "@/modules/stt/lib/client";
import { sttDeviceChoices } from "@/modules/stt/lib/devices";
import {
  sttNative,
  transcriberModelStatusOf,
  transcriberStatusOf,
} from "@/modules/stt/lib/native";
import { useSttSpeed } from "@/modules/stt/lib/useSttSpeed";
import {
  DEVICE_LABELS,
  formatApproxBytes,
  formatBytes,
  isRunning,
  pickJob,
  type TtsDevice,
} from "@/modules/tts";
import {
  CloudIcon,
  Delete02Icon,
  Download04Icon,
  HardDriveIcon,
  Mic01Icon,
  PlayIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { Card, ErrorLine, JobLog, Row, type Runtime, StateBadge } from "../voice/ui";

const PROVIDER_ORDER: SttProvider[] = ["local", "openai", "groq", "whispercpp"];

const PROVIDER_DESCRIPTIONS: Record<SttProvider, string> = {
  local:
    "Transcribes with the model below, on this machine. Audio never leaves it.",
  openai: "Sends the recording to OpenAI's Whisper with your API key.",
  groq: "Sends the recording to Groq's Whisper endpoint with your API key.",
  whispercpp: "Posts the recording to a Whisper.cpp server you run on loopback.",
};

export function ModelsTab({ runtime }: { runtime: Runtime }) {
  return (
    <section className="flex flex-col gap-3">
      <ProviderChoiceCard runtime={runtime} />
      {STT_TIERS.map((tier) =>
        tier.state === "available" ? (
          <TierCard key={tier.id} tier={tier} runtime={runtime} />
        ) : (
          <PlannedTierCard key={tier.id} tier={tier} />
        ),
      )}
      <CloudProvidersCard />
    </section>
  );
}

function ProviderChoiceCard({ runtime }: { runtime: Runtime }) {
  const provider = usePreferencesStore((s) => s.sttProvider);
  const model = usePreferencesStore((s) => s.sttLocalModel);
  const installed =
    transcriberStatusOf(runtime.status, STT_MODEL_ENGINE[model])?.installed ?? false;

  return (
    <Card
      title="Who transcribes"
      icon={Mic01Icon}
      subtitle="Dictation in the AI chat uses this provider."
    >
      <Row label="Provider">
        <Select
          value={provider}
          onValueChange={(value) => void setSttProvider(value as SttProvider)}
        >
          <SelectTrigger
            aria-label="Dictation provider"
            className="h-8 w-full text-[11.5px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_ORDER.map((id) => (
              <SelectItem key={id} value={id} className="text-[12px]">
                {STT_PROVIDER_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        {PROVIDER_DESCRIPTIONS[provider]}
        {provider === "local" && !installed
          ? " Install the Light model below before dictating."
          : null}
      </p>
    </Card>
  );
}

function TierCard({ tier, runtime }: { tier: SttTier; runtime: Runtime }) {
  const model = tier.model;
  if (!model) return null;
  return <AvailableTier tier={tier} model={model} runtime={runtime} />;
}

function AvailableTier({
  tier,
  model,
  runtime,
}: {
  tier: SttTier;
  model: NonNullable<SttTier["model"]>;
  runtime: Runtime;
}) {
  const engine = STT_MODEL_ENGINE[model];
  const provider = usePreferencesStore((s) => s.sttProvider);
  const device = usePreferencesStore((s) => s.sttDevice);
  const speed = useSttSpeed(model);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entry = transcriberStatusOf(runtime.status, engine);
  const modelStatus = transcriberModelStatusOf(runtime.status, model);
  const job = pickJob(
    runtime.jobs,
    (j) =>
      (j.engine as string | null) === engine &&
      (j.kind === "engine-install" ||
        j.kind === "engine-remove" ||
        j.kind === "model-download"),
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

  const backendKnows = !!runtime.status && entry !== null;
  const installed = entry?.installed ?? false;
  const running = entry?.running ?? false;
  const plan = entry?.plan ?? null;
  const unsupported = plan ? !plan.supported : false;
  const choices = sttDeviceChoices(plan, runtime.status?.hardware);
  const installBytes = STT_ENGINE_APPROX_BYTES[engine] + STT_MODEL_APPROX_BYTES[model];
  const working = !!busy || isRunning(job);
  const measured = formatSttSpeed(speed);
  const fit = unsupported
    ? { tone: "bad", label: "Not available here" }
    : plan?.device === "cpu"
      ? { tone: "warn", label: "Runs on the CPU here" }
      : plan
        ? { tone: "ok", label: "Suits this machine" }
        : null;

  return (
    <Card
      title={`${tier.label}: ${STT_MODEL_LABELS[model]}`}
      icon={HardDriveIcon}
      subtitle={tier.summary}
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
                      ? async () => {
                          await sttNative.stop(engine);
                          forgetWarmTranscribers();
                        }
                      : () => sttNative.start(engine, device),
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
                  void run("remove", async () => {
                    await sttNative.removeEngine(engine);
                    forgetWarmTranscribers();
                  })
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
              disabled={working || unsupported || (!!runtime.status && !backendKnows)}
              title={
                unsupported
                  ? (plan?.unsupportedReason ?? undefined)
                  : runtime.status && !backendKnows
                    ? "This build of Terax does not include the dictation engine."
                    : undefined
              }
              onClick={() => void run("install", () => sttNative.installEngine(engine))}
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
          <dt className="text-muted-foreground">Memory</dt>
          <dd>{tier.memory}</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground">Languages</dt>
          <dd>45, Spanish and English included</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground">Disk</dt>
          <dd>
            {installed
              ? `${formatBytes((entry?.sizeBytes ?? 0) + (modelStatus?.sizeBytes ?? 0))} installed`
              : `About ${formatApproxBytes(installBytes)}`}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground">Speed here</dt>
          <dd>{measured ? `Measured: ${measured}` : "Not measured yet"}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-0.5 text-[10.5px] text-muted-foreground">
        <span>
          <span className="text-foreground">Recogniser:</span> {tier.asr}
        </span>
        <span>
          <span className="text-foreground">Clean-up:</span> {tier.refiner}
        </span>
        <span>{tier.facts.join(". ")}.</span>
        {speed?.selfTest ? (
          <span>
            Self-test at start-up:{" "}
            {speed.selfTest.ok
              ? `passed in ${speed.selfTest.elapsedMs} ms (silence stayed silent).`
              : "failed. Restart the engine; if it fails again, reinstall it."}
          </span>
        ) : null}
      </div>
      {unsupported ? (
        <p className="text-[10.5px] text-muted-foreground">{plan?.unsupportedReason}</p>
      ) : null}
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
            onValueChange={(value) => void setSttDevice(value as TtsDevice)}
          >
            <SelectTrigger
              aria-label={`Compute device for ${STT_ENGINE_LABELS[engine]}`}
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
      {installed ? (
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-card/40 px-2.5 py-1.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[11.5px] font-medium">
              {STT_MODEL_LABELS[model]}
            </span>
            <span className="truncate text-[10.5px] text-muted-foreground">
              Reson8/Rumble-2-Flash, bf16 weights, Apache 2.0
            </span>
          </span>
          <span className="shrink-0 text-[10.5px] text-muted-foreground">
            {modelStatus?.downloaded
              ? formatBytes(modelStatus.sizeBytes)
              : formatApproxBytes(STT_MODEL_APPROX_BYTES[model])}
          </span>
          {modelStatus?.downloaded ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-[10.5px] text-muted-foreground hover:text-destructive"
              disabled={working}
              onClick={() => void run(model, () => sttNative.removeModel(model))}
            >
              Remove
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-6 shrink-0 gap-1 px-2 text-[10.5px]"
              disabled={working}
              onClick={() => void run(model, () => sttNative.downloadModel(model))}
            >
              {busy === model ? <Spinner className="size-3" /> : null}
              Download
            </Button>
          )}
        </div>
      ) : null}
      {installed && provider !== "local" ? (
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] text-muted-foreground">
            Dictation still goes to {STT_PROVIDER_LABELS[provider]}.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10.5px]"
            onClick={() => void setSttProvider("local")}
          >
            Use for dictation
          </Button>
        </div>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      <JobLog runtime={runtime} job={job} />
    </Card>
  );
}

function PlannedTierCard({ tier }: { tier: SttTier }) {
  return (
    <div className="opacity-70">
      <Card
        title={tier.label}
        icon={HardDriveIcon}
        subtitle={tier.summary}
        action={
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Planned
          </span>
        }
      >
        <dl className="grid grid-cols-1 gap-y-1 text-[10.5px] sm:grid-cols-3 sm:gap-x-4">
          <div className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground">Memory</dt>
            <dd>{tier.memory}</dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground">Recogniser</dt>
            <dd>{tier.asr}</dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-muted-foreground">Clean-up</dt>
            <dd>{tier.refiner}</dd>
          </div>
        </dl>
        <p className="text-[10.5px] text-muted-foreground">
          {tier.facts.join(". ")}. Not installable yet.
        </p>
      </Card>
    </div>
  );
}

function CloudProvidersCard() {
  const provider = usePreferencesStore((s) => s.sttProvider);
  const groqSttModel = usePreferencesStore((s) => s.groqSttModel);
  const whispercppBaseURL = usePreferencesStore((s) => s.whispercppBaseURL);
  const [urlDraft, setUrlDraft] = useState(whispercppBaseURL);
  const [groqModelDraft, setGroqModelDraft] = useState(groqSttModel);

  useEffect(() => setUrlDraft(whispercppBaseURL), [whispercppBaseURL]);
  useEffect(() => setGroqModelDraft(groqSttModel), [groqSttModel]);

  return (
    <Card
      title="Cloud and external providers"
      icon={CloudIcon}
      subtitle="OpenAI and Groq need their API key in Settings, Models. Whisper.cpp runs where you start it."
      action={
        provider !== "local" ? (
          <StateBadge ok label={`In use: ${STT_PROVIDER_LABELS[provider]}`} />
        ) : null
      }
    >
      <Row label="Groq model">
        <Input
          value={groqModelDraft}
          onChange={(e) => setGroqModelDraft(e.target.value)}
          onBlur={() => {
            const v = groqModelDraft.trim();
            if (v !== groqSttModel) void setGroqSttModel(v);
          }}
          placeholder="whisper-large-v3-turbo"
          spellCheck={false}
          aria-label="Groq transcription model"
          className="h-8 font-mono text-[11.5px]"
        />
      </Row>
      <Row label="Whisper.cpp">
        <Input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onBlur={() => {
            const v = urlDraft.trim();
            if (v !== whispercppBaseURL) void setWhispercppBaseURL(v);
          }}
          placeholder={WHISPERCPP_DEFAULT_BASE_URL}
          spellCheck={false}
          aria-label="Whisper.cpp server URL"
          className="h-8 font-mono text-[11.5px]"
        />
      </Row>
      <p className="text-[10.5px] text-muted-foreground">
        The Whisper.cpp URL must be a loopback address, so the recording stays on
        this machine.
      </p>
    </Card>
  );
}
