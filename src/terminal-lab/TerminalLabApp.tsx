import { ensureMonoFontsLoaded } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  type BenchKind,
  engineAvailable,
  labAutorunPath,
  submitLabReport,
} from "@/modules/terminal/gl/engineSession";
import type { RendererFont } from "@/modules/terminal/gl/gridRenderer";
import { BenchPanel } from "@/terminal-lab/BenchPanel";
import { EnginePane } from "@/terminal-lab/EnginePane";
import { DEFAULT_MEGABYTES } from "@/terminal-lab/lib/bench";
import type { EchoTarget } from "@/terminal-lab/lib/echo";
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
import { XtermPane } from "@/terminal-lab/XtermPane";
import { useCallback, useEffect, useRef, useState } from "react";

const ENABLE_HINT =
  "node scripts/with-zig.mjs -- pnpm dev:sandbox --features ghostty-engine";
const READY_TIMEOUT_MS = 20_000;
const SHELL_SETTLE_MS = 1500;
const AUTORUN_WATCHDOG_MS = 15 * 60_000;

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
 * Developer window comparing the libghostty-vt engine with xterm.js and
 * measuring the frame path. Opened from the palette or by autorun.
 */
export function TerminalLabApp() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [autorun, setAutorun] = useState<string | null>(null);
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
  const engineTarget = useRef<EchoTarget | null>(null);
  const xtermTarget = useRef<EchoTarget | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const liveReport = useRef<LabReport | null>(null);

  useEffect(() => {
    latest.current = { font, colors };
  }, [font, colors]);

  const progress = useCallback((current: LabReport, label: string) => {
    liveReport.current = current;
    step.current = label;
    setReport({ ...current });
    setStepLabel(label);
  }, []);

  const runEverything = useCallback(
    async (megabytes: Record<BenchKind, [number, number]>) => {
      const stage = stageRef.current;
      if (!stage) return emptyReport(true, latest.current.font);
      const report = emptyReport(true, latest.current.font);
      setRunning(true);
      try {
        return await runAll(
          {
            stage,
            font: latest.current.font,
            colors: latest.current.colors,
            megabytes,
            engine: engineTarget.current,
            xterm: xtermTarget.current,
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
      report.echo.xterm = await echoOf(
        "xterm",
        xtermTarget.current,
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
      setAvailable(ok);
      if (!path) return;
      setAutorun(path);
      const partial = emptyReport(ok, latest.current.font);
      const watchdog = setTimeout(() => {
        const current = liveReport.current ?? partial;
        current.errors.push(`autorun watchdog fired at step ${step.current}`);
        void submitLabReport(JSON.stringify(current, null, 2));
      }, AUTORUN_WATCHDOG_MS);
      let result = partial;
      try {
        if (ok) {
          const ready = await waitFor(
            () =>
              engineTarget.current !== null &&
              xtermTarget.current !== null &&
              stageRef.current !== null,
            READY_TIMEOUT_MS,
          );
          if (!ready) partial.errors.push("panes not ready before the run");
          await sleep(SHELL_SETTLE_MS);
          result = await runEverything(DEFAULT_MEGABYTES);
          result.errors.unshift(...partial.errors);
        } else {
          partial.errors.push("engine unavailable in this build");
        }
      } catch (error) {
        result.errors.push(
          `autorun: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(watchdog);
        result.finishedAt ??= new Date().toISOString();
        await submitLabReport(JSON.stringify(result, null, 2)).catch((error) =>
          console.error("terminal lab report failed:", error),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runEverything]);

  const setEngineTarget = useCallback((target: EchoTarget | null) => {
    engineTarget.current = target;
  }, []);
  const setXtermTarget = useCallback((target: EchoTarget | null) => {
    xtermTarget.current = target;
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
          This build lacks the ghostty-engine feature. Run{" "}
          <code className="font-mono">{ENABLE_HINT}</code> to enable it.
        </p>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
          <div
            className="flex shrink-0 gap-3"
            style={{ height: "40%", minHeight: 192 }}
          >
            <EnginePane
              font={font}
              colors={colors}
              onTarget={setEngineTarget}
            />
            <XtermPane font={font} onTarget={setXtermTarget} />
          </div>
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
