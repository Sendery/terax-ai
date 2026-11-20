import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ttsNative, type TtsJob, type useTtsRuntime } from "@/modules/tts";
import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  type HardDriveIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";

export type Runtime = ReturnType<typeof useTtsRuntime>;

export function JobLog({ runtime, job }: { runtime: Runtime; job: TtsJob | null }) {
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

export function Card({
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

export function Row({
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
export function FieldLabel({
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

export function StateBadge({ ok, label }: { ok: boolean; label: string }) {
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

export function ErrorLine({ message }: { message: string }) {
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
