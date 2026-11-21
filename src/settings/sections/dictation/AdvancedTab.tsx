import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { STT_ENGINES, STT_ENGINE_LABELS, STT_MODEL_LABELS } from "@/modules/stt/lib/catalog";
import { transcriberModelStatusOf, transcriberStatusOf } from "@/modules/stt/lib/native";
import { STT_LOCAL_MODELS } from "@/modules/stt/lib/settings";
import { formatBytes, isRunning, pickJob, ttsNative } from "@/modules/tts";
import {
  Download04Icon,
  FolderOpenIcon,
  HardDriveIcon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Card, ErrorLine, JobLog, Row, type Runtime, StateBadge } from "../voice/ui";

export function AdvancedTab({ runtime }: { runtime: Runtime }) {
  return (
    <section className="flex flex-col gap-3">
      <RuntimeCard runtime={runtime} />
      <IdleCard />
      <StorageCard runtime={runtime} />
    </section>
  );
}

function RuntimeCard({ runtime }: { runtime: Runtime }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = runtime.status?.runtime;
  const job = pickJob(runtime.jobs, (j) => j.kind === "runtime");

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await ttsNative.installRuntime();
      await runtime.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Runtime"
      icon={Rocket01Icon}
      subtitle="The same private Python and uv the reading voices use. Installing the dictation model installs it if needed."
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
      <p className="text-[10.5px] text-muted-foreground">
        {info?.installed
          ? `uv ${info.uvVersion ?? "unknown"} with Python ${info.pythonVersion ?? "unknown"}. Shared with Settings, Voice.`
          : "Not installed. About 120 MB goes into the Terax data folder; nothing outside it is touched."}
      </p>
      {runtime.status?.hardwareSummary ? (
        <p className="text-[10.5px] text-muted-foreground">
          This machine: {runtime.status.hardwareSummary}.
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      <JobLog runtime={runtime} job={job} />
    </Card>
  );
}

function IdleCard() {
  const minutes = usePreferencesStore((s) => s.ttsIdleStopMinutes);
  return (
    <Card title="Idle stop" icon={Rocket01Icon}>
      <p className="text-[10.5px] text-muted-foreground">
        {minutes === 0
          ? "The dictation engine stays loaded until you stop it."
          : `The dictation engine stops ${minutes} minutes after the last dictation and gives its memory back; the next dictation starts it again.`}{" "}
        The minutes are shared with the reading voices and set in Settings, Voice,
        Advanced.
      </p>
    </Card>
  );
}

function StorageCard({ runtime }: { runtime: Runtime }) {
  const [error, setError] = useState<string | null>(null);
  const engineBytes = STT_ENGINES.reduce(
    (sum, engine) => sum + (transcriberStatusOf(runtime.status, engine)?.sizeBytes ?? 0),
    0,
  );
  const modelBytes = STT_LOCAL_MODELS.reduce(
    (sum, model) =>
      sum + (transcriberModelStatusOf(runtime.status, model)?.sizeBytes ?? 0),
    0,
  );
  const reveal = async () => {
    setError(null);
    try {
      await ttsNative.revealDir("models");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card
      title="Storage"
      icon={HardDriveIcon}
      subtitle="Dictation lives in the same folder as the reading voices."
      action={
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          onClick={() => void reveal()}
        >
          <HugeiconsIcon icon={FolderOpenIcon} size={12} strokeWidth={1.75} />
          Open models folder
        </Button>
      }
    >
      <Row label="Engine">
        <span className="text-[11px]">
          {STT_ENGINES.map((e) => STT_ENGINE_LABELS[e]).join(", ")}:{" "}
          {formatBytes(engineBytes)}
        </span>
      </Row>
      <Row label="Model">
        <span className="text-[11px]">
          {STT_LOCAL_MODELS.map((m) => STT_MODEL_LABELS[m]).join(", ")}:{" "}
          {formatBytes(modelBytes)}
        </span>
      </Row>
      <p className="text-[10.5px] text-muted-foreground">
        Remove the engine or the model from the Models tab. Deleting everything,
        voices included, is in Settings, Voice, Advanced.
      </p>
      {error ? <ErrorLine message={error} /> : null}
    </Card>
  );
}
