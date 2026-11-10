import type { BenchKind } from "@/modules/terminal/gl/engineSession";
import type { RendererFont } from "@/modules/terminal/gl/gridRenderer";
import {
  BENCH_KINDS,
  BENCH_SESSION_COUNTS,
  type BenchRun,
  DEFAULT_MEGABYTES,
  runBench,
} from "@/terminal-lab/lib/bench";
import {
  type EchoResult,
  type EchoTarget,
  measureEcho,
} from "@/terminal-lab/lib/echo";
import type { LabColors } from "@/terminal-lab/lib/useLabAppearance";

const ECHO_SAMPLES = 50;

export const TIMER_NOTE =
  "WebKit clamps performance.now() to 1 ms, so every timing is a distribution over many samples and single values carry +-1 ms.";

export type LabReport = {
  version: 1;
  startedAt: string;
  finishedAt: string | null;
  userAgent: string;
  devicePixelRatio: number;
  timerNote: string;
  engineAvailable: boolean;
  font: RendererFont;
  bench: BenchRun[];
  echo: { engine: EchoResult | null; xterm: EchoResult | null };
  errors: string[];
};

export function emptyReport(
  engineAvailable: boolean,
  font: RendererFont,
): LabReport {
  return {
    version: 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    timerNote: TIMER_NOTE,
    engineAvailable,
    font,
    bench: [],
    echo: { engine: null, xterm: null },
    errors: [],
  };
}

export type RunPlan = {
  stage: HTMLElement;
  font: RendererFont;
  colors: LabColors;
  megabytes: Record<BenchKind, [number, number]>;
  engine: EchoTarget | null;
  xterm: EchoTarget | null;
  onProgress: (report: LabReport, step: string) => void;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every measurement of the contract's phase 1 list that the webview can take. */
export async function runAll(
  plan: RunPlan,
  report: LabReport,
): Promise<LabReport> {
  for (const kind of BENCH_KINDS) {
    for (const [slot, sessions] of BENCH_SESSION_COUNTS.entries()) {
      const megabytes =
        plan.megabytes[kind][slot] ?? DEFAULT_MEGABYTES[kind][slot];
      plan.onProgress(report, `bench ${kind} x${sessions}`);
      try {
        const run = await runBench(
          plan.stage,
          plan.font,
          plan.colors,
          kind,
          sessions,
          megabytes,
        );
        report.bench.push(run);
        if (run.error)
          report.errors.push(`bench ${kind} x${sessions}: ${run.error}`);
      } catch (error) {
        report.errors.push(`bench ${kind} x${sessions}: ${message(error)}`);
      }
      plan.onProgress(report, `bench ${kind} x${sessions} done`);
    }
  }
  report.echo.engine = await echoOf("engine", plan.engine, plan, report);
  report.echo.xterm = await echoOf("xterm", plan.xterm, plan, report);
  report.finishedAt = new Date().toISOString();
  plan.onProgress(report, "done");
  return report;
}

export async function echoOf(
  name: string,
  target: EchoTarget | null,
  plan: Pick<RunPlan, "onProgress">,
  report: LabReport,
): Promise<EchoResult | null> {
  if (!target) {
    report.errors.push(`echo ${name}: pane not ready`);
    return null;
  }
  plan.onProgress(report, `echo ${name}`);
  try {
    const result = await measureEcho(target, ECHO_SAMPLES);
    if (result.error) report.errors.push(`echo ${name}: ${result.error}`);
    return result;
  } catch (error) {
    report.errors.push(`echo ${name}: ${message(error)}`);
    return null;
  }
}
