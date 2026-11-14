import { runBench } from "@/terminal-lab/lib/bench";
import type { RunPlan, LabReport } from "@/terminal-lab/lib/report";

export const GATE_MEGABYTES_PER_SESSION = 1024;

/** Fixed before measurement; no xterm comparison can interrupt collection of the engine gate. */
export async function runEngineGate(
  plan: Pick<RunPlan, "stage" | "font" | "colors" | "onProgress">,
  report: LabReport,
): Promise<LabReport> {
  for (const kind of ["ascii", "sgr", "tui"] as const) {
    const label = `gate ${kind} x12`;
    plan.onProgress(report, label);
    try {
      const run = await runBench(
        plan.stage,
        plan.font,
        plan.colors,
        kind,
        12,
        GATE_MEGABYTES_PER_SESSION,
      );
      report.bench.push(run);
      if (run.error) report.errors.push(`${label}: ${run.error}`);
      if (run.timedOut) report.errors.push(`${label}: timed out`);
      if (run.decodeErrors > 0)
        report.errors.push(`${label}: ${run.decodeErrors} decode errors`);
      if (run.rust.some((stats) => stats === null))
        report.errors.push(`${label}: Rust statistics missing`);
    } catch (error) {
      report.errors.push(`${label}: ${String(error)}`);
    }
    plan.onProgress(report, `${label} done`);
  }
  report.finishedAt = new Date().toISOString();
  plan.onProgress(report, "done");
  return report;
}
