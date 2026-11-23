import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  CLEANUP_ENGINE_APPROX_BYTES,
  CLEANUP_ENGINE_CUDA_APPROX_BYTES,
  CLEANUP_ENGINE_DESCRIPTIONS,
  CLEANUP_ENGINE_LABELS,
  CLEANUP_MODEL_APPROX_BYTES,
  ISOLATOR_ENGINE,
  ISOLATOR_MODEL,
} from "@/modules/isolator/lib/catalog";
import {
  cleanerModelStatusOf,
  cleanerStatusOf,
  isolatorNative,
} from "@/modules/isolator/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setCleanDictationAudio,
  setCleanReadingAudio,
  setCleanVoiceSamples,
  setIsolatorDevice,
} from "@/modules/settings/store";
import { sttDeviceChoices } from "@/modules/stt/lib/devices";
import {
  DEVICE_LABELS,
  formatApproxBytes,
  formatBytes,
  isRunning,
  pickJob,
  type TtsDevice,
} from "@/modules/tts";
import {
  Delete02Icon,
  Download04Icon,
  PlayIcon,
  SparklesIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  Card,
  ErrorLine,
  JobLog,
  PlanWarnings,
  Row,
  type Runtime,
  StateBadge,
} from "./ui";

const engine = ISOLATOR_ENGINE;
const model = ISOLATOR_MODEL;

type Toggle = {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  set: (value: boolean) => Promise<void>;
};

/**
 * Inworld's Voice Isolator: one engine that cleans dictation input, reading
 * output and voice samples. Offered on every machine; the plan says what it
 * costs on this one.
 */
export function CleanupCard({ runtime }: { runtime: Runtime }) {
  const device = usePreferencesStore((s) => s.isolatorDevice);
  const cleanDictation = usePreferencesStore((s) => s.cleanDictationAudio);
  const cleanReading = usePreferencesStore((s) => s.cleanReadingAudio);
  const cleanSamples = usePreferencesStore((s) => s.cleanVoiceSamples);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entry = cleanerStatusOf(runtime.status, engine);
  const modelStatus = cleanerModelStatusOf(runtime.status, model);
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
  const downloaded = modelStatus?.downloaded ?? false;
  const plan = entry?.plan ?? null;
  const unsupported = plan ? !plan.supported : false;
  const choices = sttDeviceChoices(plan, runtime.status?.hardware);
  const engineBytes =
    plan?.torchBackend === "auto"
      ? CLEANUP_ENGINE_CUDA_APPROX_BYTES[engine]
      : CLEANUP_ENGINE_APPROX_BYTES[engine];
  const installBytes = engineBytes + CLEANUP_MODEL_APPROX_BYTES[model];
  const working = !!busy || isRunning(job);
  const ready = installed && downloaded;
  const fit = unsupported
    ? { tone: "bad", label: "Not available here" }
    : plan && (plan.warnings?.length ?? 0) > 0
      ? { tone: "warn", label: plan.device === "cpu" ? "Slow on the CPU" : "See note" }
      : plan
        ? { tone: "ok", label: "Suits this machine" }
        : null;

  const toggles: Toggle[] = [
    {
      id: "dictation",
      label: "Clean dictation input",
      hint: "Each dictated segment is cleaned before it is transcribed. Adds the cleanup time to every segment.",
      checked: cleanDictation,
      set: setCleanDictationAudio,
    },
    {
      id: "reading",
      label: "Clean reading output",
      hint: "Speak and the Reader clean each sentence before it plays. Synthesized speech is usually clean already: worth it mainly for cloned voices that copied a noisy sample.",
      checked: cleanReading,
      set: setCleanReadingAudio,
    },
    {
      id: "samples",
      label: "Clean imported voice samples",
      hint: "A sample is cleaned once, before it is stored for cloning, so the clone does not copy the room. Practical even on a CPU.",
      checked: cleanSamples,
      set: setCleanVoiceSamples,
    },
  ];

  return (
    <Card
      title={`Audio cleanup: ${CLEANUP_ENGINE_LABELS[engine]}`}
      icon={SparklesIcon}
      subtitle={CLEANUP_ENGINE_DESCRIPTIONS[engine]}
      action={
        <div className="flex items-center gap-1.5">
          {fit ? (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px]",
                fit.tone === "bad" && "bg-destructive/10 text-destructive",
                fit.tone === "warn" &&
                  "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                fit.tone === "ok" &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
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
                disabled={working || !downloaded}
                onClick={() =>
                  void run(
                    running ? "stop" : "start",
                    running
                      ? () => isolatorNative.stop(engine)
                      : () => isolatorNative.start(engine, device),
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
                onClick={() => void run("remove", () => isolatorNative.removeEngine(engine))}
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
                    ? "This build of Terax does not include audio cleanup."
                    : undefined
              }
              onClick={() => void run("install", () => isolatorNative.installEngine(engine))}
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

      <div className="flex flex-col gap-2">
        {toggles.map((toggle) => (
          <label
            key={toggle.id}
            className="flex items-start justify-between gap-3 text-[11.5px]"
          >
            <span className="flex min-w-0 flex-col">
              <span>{toggle.label}</span>
              <span className="text-[10.5px] text-muted-foreground">{toggle.hint}</span>
            </span>
            <Switch
              checked={toggle.checked}
              onCheckedChange={(checked) => void toggle.set(checked)}
              aria-label={toggle.label}
            />
          </label>
        ))}
        {!ready && (cleanDictation || cleanReading || cleanSamples) ? (
          <p className="text-[10.5px] text-muted-foreground">
            Cleanup is switched on but the engine is not ready, so audio is
            used as recorded until it is installed.
          </p>
        ) : null}
      </div>

      {choices.length > 0 ? (
        <Row label="Device">
          <Select
            value={device}
            onValueChange={(value) => void setIsolatorDevice(value as TtsDevice)}
          >
            <SelectTrigger
              aria-label={`Compute device for ${CLEANUP_ENGINE_LABELS[engine]}`}
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
              Voice Isolator v1 (offline)
            </span>
            <span className="truncate text-[10.5px] text-muted-foreground">
              inworld/voice-isolator, 64M parameters, 48 kHz, Apache 2.0
            </span>
          </span>
          <span className="shrink-0 text-[10.5px] text-muted-foreground">
            {downloaded
              ? formatBytes(modelStatus?.sizeBytes ?? 0)
              : formatApproxBytes(CLEANUP_MODEL_APPROX_BYTES[model])}
          </span>
          {downloaded ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-[10.5px] text-muted-foreground hover:text-destructive"
              disabled={working}
              onClick={() => void run(model, () => isolatorNative.removeModel(model))}
            >
              Remove
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-6 shrink-0 gap-1 px-2 text-[10.5px]"
              disabled={working}
              onClick={() => void run(model, () => isolatorNative.downloadModel(model))}
            >
              {busy === model ? <Spinner className="size-3" /> : null}
              Download
            </Button>
          )}
        </div>
      ) : null}

      <JobLog runtime={runtime} job={job} />
      {error ? <ErrorLine message={error} /> : null}
    </Card>
  );
}
