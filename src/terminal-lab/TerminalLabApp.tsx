import { ensureMonoFontsLoaded } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type BenchKind,
  engineAvailable,
  labAutorunPath,
  labConfig,
  labStatus,
  saveLabCapture,
  submitLabReport,
} from "@/modules/terminal/gl/engineSession";
import type { RendererFont } from "@/modules/terminal/gl/gridRenderer";
import { BenchPanel } from "@/terminal-lab/BenchPanel";
import { EnginePane } from "@/terminal-lab/EnginePane";
import { DEFAULT_MEGABYTES } from "@/terminal-lab/lib/bench";
import {
  type AutorunConfig,
  gpuMetadata,
  type LabTarget,
  scriptedSession,
} from "@/terminal-lab/lib/autorun";
import { runEngineGate } from "@/terminal-lab/lib/gate";
import { runIdle } from "@/terminal-lab/lib/idle";
import {
  echoOf,
  emptyReport,
  type LabReport,
  runAll,
} from "@/terminal-lab/lib/report";
import {
  type LabColors,
  useLabColors,
  useLabFont,
} from "@/terminal-lab/lib/useLabAppearance";
import { useCallback, useEffect, useRef, useState } from "react";

const READY_TIMEOUT_MS = 20_000;
const SHELL_SETTLE_MS = 1500;
const AUTORUN_WATCHDOG_MS = 40 * 60_000;

function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = performance.now();
    const poll = () => {
      if (check()) return resolve(true);
      if (performance.now() - started > timeoutMs) return resolve(false);
      setTimeout(poll, 100);
    };
    poll();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Lab-only rules stay in the lab's chunk instead of the shared stylesheet
// every window loads.
const LAB_CSS =
  ".lab-table{border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums}.lab-table td,.lab-table th{padding:2px 6px}.lab-table th{font-weight:500}";

/**
 * Developer window measuring the libghostty-vt engine and its frame path.
 * Opened from the palette or by autorun.
 */
export function TerminalLabApp() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [autorun, setAutorun] = useState<string | null>(null);
  const [config, setConfig] = useState<AutorunConfig | null>(null);
  const [report, setReport] = useState<LabReport | null>(null);
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const step = useRef("start");
  const [running, setRunning] = useState(false);
  const font = useLabFont();
  const colors = useLabColors();
  const latest = useRef<{ font: RendererFont; colors: LabColors }>({
    font,
    colors,
  });
  const engineTarget = useRef<LabTarget | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const liveReport = useRef<LabReport | null>(null);
  const isAutorun = useRef(false);
  const progressSequence = useRef(0);
  const reportFailed = useRef(false);
  const pendingStatus = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    latest.current = { font, colors };
  }, [font, colors]);

  const failReport = useCallback(
    async (current: LabReport, label: string, error: unknown) => {
      if (reportFailed.current) return;
      reportFailed.current = true;
      const message = `report ${label}: ${String(error).slice(0, 1024)}`;
      current.errors.push(message);
      await labStatus({
        status: "failed",
        step: label,
        error: message,
        sequence: ++progressSequence.current,
      }).catch((failure) =>
        console.error("lab failure status failed", failure),
      );
    },
    [],
  );

  const progress = useCallback(
    (current: LabReport, label: string) => {
      liveReport.current = current;
      step.current = label;
      setReport({ ...current });
      setStepLabel(label);
      if (isAutorun.current && !reportFailed.current) {
        const saved = labStatus({
          status: "running",
          step: label,
          at: new Date().toISOString(),
          sequence: ++progressSequence.current,
          checkpoint: current,
        }).catch((error) => {
          return failReport(current, `checkpoint ${label}`, error);
        });
        pendingStatus.current = Promise.all([
          pendingStatus.current,
          saved,
        ]).then(() => {});
      }
    },
    [failReport],
  );

  const runEverything = useCallback(
    async (
      megabytes: Record<BenchKind, [number, number]>,
      initialReport?: LabReport,
    ) => {
      const stage = stageRef.current;
      if (!stage) return emptyReport(true, latest.current.font);
      const report = initialReport ?? emptyReport(true, latest.current.font);
      setRunning(true);
      try {
        return await runAll(
          {
            stage,
            font: latest.current.font,
            colors: latest.current.colors,
            megabytes,
            engine: engineTarget.current,
            onProgress: progress,
          },
          report,
        );
      } finally {
        setRunning(false);
      }
    },
    [progress],
  );

  const runEcho = useCallback(async () => {
    const report = emptyReport(true, latest.current.font);
    setRunning(true);
    try {
      report.echo.engine = await echoOf(
        "engine",
        engineTarget.current,
        { onProgress: progress },
        report,
      );
      report.finishedAt = new Date().toISOString();
      progress(report, "done");
    } finally {
      setRunning(false);
    }
  }, [progress]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [ok, path] = await Promise.all([
        engineAvailable(),
        labAutorunPath(),
        ensureMonoFontsLoaded(),
      ]);
      // The panes measure their font once on mount; give them the user's.
      await waitFor(
        () => usePreferencesStore.getState().hydrated,
        READY_TIMEOUT_MS,
      );
      if (cancelled) return;
      if (!path) {
        setAvailable(ok);
        return;
      }
      setAutorun(path);
      isAutorun.current = true;
      const partial = emptyReport(ok, latest.current.font);
      const watchdog = setTimeout(() => {
        const current = liveReport.current ?? partial;
        current.errors.push(`autorun watchdog fired at step ${step.current}`);
        if (!reportFailed.current)
          void submitLabReport(current).catch((error) =>
            failReport(current, "watchdog", error),
          );
      }, AUTORUN_WATCHDOG_MS);
      let result = partial;
      try {
        const config = await labConfig();
        await labStatus({
          status: "starting",
          mode: config.mode,
          at: new Date().toISOString(),
        });
        setConfig(config);
        setAvailable(ok);
        if (ok) {
          const ready = await waitFor(
            () =>
              (config.mode !== "bench" || engineTarget.current !== null) &&
              stageRef.current !== null,
            READY_TIMEOUT_MS,
          );
          if (!ready) throw new Error("panes not ready before the run");
          await sleep(SHELL_SETTLE_MS);
          if (
            config.mode === "gate-engine" ||
            config.mode === "gate-engine-profile" ||
            config.mode === "gate-engine-batched" ||
            config.mode === "gate-engine-profile-batched"
          ) {
            const stage = stageRef.current;
            if (!stage) throw new Error("gate stage missing");
            result = await runEngineGate(
              {
                stage,
                font: latest.current.font,
                colors: latest.current.colors,
                onProgress: progress,
              },
              partial,
              config.mode === "gate-engine-profile-batched"
                ? { profile: true, batchCredits: true }
                : config.mode === "gate-engine-batched"
                  ? { profile: false, batchCredits: true }
                  : config.mode === "gate-engine-profile"
                    ? { profile: true }
                    : undefined,
            );
          } else if (config.mode !== "bench") {
            const stage = stageRef.current;
            if (!stage) throw new Error("idle stage missing");
            progress(partial, config.mode);
            partial.idle = await runIdle(
              stage,
              latest.current.font,
              latest.current.colors,
              config,
            );
          } else {
            progress(partial, "capture engine");
            try {
              const target = engineTarget.current;
              if (!target) throw new Error("pane not ready");
              await saveLabCapture("engine", await scriptedSession(target));
              partial.captures.engine = true;
            } catch (error) {
              partial.errors.push(`capture engine: ${String(error)}`);
            }
            const canvas = document.querySelector("canvas");
            if (canvas) partial.runtime.gpu = gpuMetadata(canvas);
            result = await runEverything(DEFAULT_MEGABYTES, partial);
          }
        } else {
          partial.errors.push("engine unavailable in this build");
        }
      } catch (error) {
        result.errors.push(
          `autorun: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(watchdog);
        await pendingStatus.current;
        result.finishedAt ??= new Date().toISOString();
        if (!reportFailed.current)
          await submitLabReport(result).catch((error) =>
            failReport(result, "final", error),
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runEverything, progress, failReport]);

  const setEngineTarget = useCallback((target: LabTarget | null) => {
    engineTarget.current = target;
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground text-xs">
      <style>{LAB_CSS}</style>
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 items-center justify-center font-medium text-muted-foreground"
      >
        Terminal Lab
      </div>
      {available === null ? (
        <p className="px-3 text-muted-foreground">Checking the engine...</p>
      ) : available === false ? (
        <p className="px-3">
          This build was compiled without the ghostty-engine feature, so the
          terminal engine is unavailable.
        </p>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
          {(!config || config.mode === "bench") && (
            <div
              className="flex shrink-0 gap-3"
              style={{ height: "40%", minHeight: 192 }}
            >
              <EnginePane
                font={font}
                colors={colors}
                autorun={autorun !== null}
                onTarget={setEngineTarget}
              />
            </div>
          )}
          <BenchPanel
            report={report}
            step={stepLabel}
            running={running}
            autorun={autorun !== null}
            stageRef={stageRef}
            onRunAll={(megabytes) => void runEverything(megabytes)}
            onRunEcho={() => void runEcho()}
          />
        </main>
      )}
    </div>
  );
}
