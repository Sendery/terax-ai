import { Button } from "@/components/ui/button";
import type { BenchKind } from "@/modules/terminal/gl/engineSession";
import type { BenchRun } from "@/terminal-lab/lib/bench";
import { BENCH_KINDS, DEFAULT_MEGABYTES } from "@/terminal-lab/lib/bench";
import type { EchoResult } from "@/terminal-lab/lib/echo";
import type { LabReport } from "@/terminal-lab/lib/report";
import { TIMER_NOTE } from "@/terminal-lab/lib/report";
import type { Distribution } from "@/terminal-lab/lib/stats";
import { type RefObject, useState } from "react";

type Props = {
  report: LabReport | null;
  step: string | null;
  running: boolean;
  autorun: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  onRunAll: (megabytes: Record<BenchKind, [number, number]>) => void;
  onRunEcho: () => void;
};

function ms(value: number | null): string {
  return value === null ? "-" : value.toFixed(1);
}

function dist(d: Distribution): string {
  return d.count === 0 ? "-" : `${ms(d.p50)} / ${ms(d.p95)} / ${ms(d.max)}`;
}

function mb(bytes: number | null): string {
  return bytes === null ? "-" : (bytes / 1_048_576).toFixed(1);
}

function BenchRow({ run }: { run: BenchRun }) {
  const rust = run.rustTotals;
  return (
    <tr className="border-border border-t">
      <td>{run.kind}</td>
      <td>{run.sessions}</td>
      <td>
        {run.cols}x{run.rows}
      </td>
      <td>{run.megabytesPerSession}</td>
      <td>{(run.wallMs / 1000).toFixed(2)}</td>
      <td>{run.framesPerSecond ?? "-"}</td>
      <td>{run.framesPerSecondPerSession ?? "-"}</td>
      <td>{mb(run.bytesPerSecond)}</td>
      <td>{dist(run.animationFrameIntervalMs)}</td>
      <td>
        {run.creditRoundTripMs.count === 0
          ? "-"
          : `${ms(run.creditRoundTripMs.p50)} / ${ms(run.creditRoundTripMs.p95)}`}
      </td>
      <td>{mb(rust.bytesFed)}</td>
      <td>{rust.frames}</td>
      <td>{rust.encodeMicrosPerFrame ?? "-"}</td>
      <td>{(rust.creditWaitMicros / 1000).toFixed(0)}</td>
      <td className="text-destructive">
        {run.error ?? (run.timedOut ? "timed out" : "")}
        {run.decodeErrors > 0 ? ` ${run.decodeErrors} bad frames` : ""}
      </td>
    </tr>
  );
}

function EchoRow({
  name,
  result,
}: {
  name: string;
  result: EchoResult | null;
}) {
  return (
    <tr className="border-border border-t">
      <td>{name}</td>
      <td>{result?.count ?? "-"}</td>
      <td>{result ? ms(result.p50) : "-"}</td>
      <td>{result ? ms(result.p95) : "-"}</td>
      <td>{result ? ms(result.max) : "-"}</td>
      <td>{result?.timeouts ?? "-"}</td>
      <td className="text-destructive">{result?.error ?? ""}</td>
    </tr>
  );
}

/** Controls, the bench stage (one canvas for every bench pane) and results. */
export function BenchPanel({
  report,
  step,
  running,
  autorun,
  stageRef,
  onRunAll,
  onRunEcho,
}: Props) {
  const [megabytes, setMegabytes] =
    useState<Record<BenchKind, [number, number]>>(DEFAULT_MEGABYTES);

  const setSize = (kind: BenchKind, slot: 0 | 1, value: string) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) return;
    setMegabytes((prev) => {
      const next: [number, number] = [...prev[kind]];
      next[slot] = Math.min(n, 4096);
      return { ...prev, [kind]: next };
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          disabled={running || autorun}
          onClick={() => onRunAll(megabytes)}
        >
          Run all
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={running || autorun}
          onClick={onRunEcho}
        >
          Keystroke echo
        </Button>
        {BENCH_KINDS.map((kind) => (
          <span
            key={kind}
            className="flex items-center gap-1 text-muted-foreground"
          >
            {kind} MB
            {([0, 1] as const).map((slot) => (
              <input
                key={slot}
                aria-label={`${kind} megabytes per session, ${slot === 0 ? "1 session" : "12 sessions"}`}
                className="rounded border border-border bg-transparent px-1 text-foreground"
                style={{ width: 56 }}
                type="number"
                min={1}
                disabled={running || autorun}
                value={megabytes[kind][slot]}
                onChange={(e) => setSize(kind, slot, e.target.value)}
              />
            ))}
          </span>
        ))}
        <span className="text-muted-foreground">
          {autorun ? "autorun " : ""}
          {step ?? "idle"}
        </span>
      </div>
      <p className="text-muted-foreground">
        {TIMER_NOTE} Bench runs use 200x60 for one session and 100x30 for
        twelve, whatever the stage size; panes past the stage are clipped, not
        skipped.
      </p>
      <div
        ref={stageRef}
        className="relative shrink-0 overflow-hidden rounded-md border border-border"
        style={{ height: 224 }}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="lab-table w-full">
          <thead className="text-muted-foreground">
            <tr>
              <th>payload</th>
              <th>sessions</th>
              <th>grid</th>
              <th>MB each</th>
              <th>wall s</th>
              <th>frames/s</th>
              <th>per session</th>
              <th>frame MB/s</th>
              <th>rAF ms p50/p95/max</th>
              <th>credit RTT ms p50/p95</th>
              <th>Rust MB fed</th>
              <th>Rust frames</th>
              <th>encode us/frame</th>
              <th>credit wait ms</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {report?.bench.map((run) => (
              <BenchRow key={`${run.kind}-${run.sessions}`} run={run} />
            ))}
          </tbody>
        </table>
        <table className="lab-table mt-3">
          <thead className="text-muted-foreground">
            <tr>
              <th>keystroke echo</th>
              <th>samples</th>
              <th>p50 ms</th>
              <th>p95 ms</th>
              <th>max ms</th>
              <th>timeouts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <EchoRow name="engine" result={report?.echo.engine ?? null} />
            <EchoRow name="xterm.js" result={report?.echo.xterm ?? null} />
          </tbody>
        </table>
        {report && report.errors.length > 0 ? (
          <ul className="mt-3 text-destructive">
            {report.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
