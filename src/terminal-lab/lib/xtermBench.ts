import {
  type BenchKind,
  labFixture,
} from "@/modules/terminal/gl/engineSession";
import type { RendererFont } from "@/modules/terminal/gl/gridRenderer";
import type { PtySession } from "@/modules/terminal/lib/pty-bridge";
import { shellQuote } from "@/terminal-lab/lib/autorun";
import { bounded, labXterm } from "@/terminal-lab/lib/labXterm";
import { PayloadWindow } from "@/terminal-lab/lib/payloadWindow";
import { PayloadCompletion } from "@/terminal-lab/lib/completion";
import { openLabPty } from "@/terminal-lab/lib/labPty";
import {
  type Distribution,
  distribution,
  intervals,
  perSecond,
  sampleAnimationFrames,
} from "@/terminal-lab/lib/stats";

export type XtermBenchRun = {
  kind: BenchKind;
  sessions: number;
  megabytesPerSession: number;
  cols: number;
  rows: number;
  payloadBytesPerSession: number;
  bytesReceived: number;
  wallMs: number;
  bytesPerSecond: number | null;
  renderEvents: number;
  renderEventsPerSecondPerSession: number | null;
  animationFrameIntervalMs: Distribution;
  transport: "pty_open";
  renderer: "xterm-webgl";
  error?: string;
};

export async function runXtermBench(
  stage: HTMLElement,
  font: RendererFont,
  kind: BenchKind,
  sessions: number,
  megabytes: number,
): Promise<XtermBenchRun> {
  const cols = sessions === 1 ? 200 : 100;
  const rows = sessions === 1 ? 60 : 30;
  const fixture = await labFixture(kind, megabytes, rows);
  const surfaces: ReturnType<typeof labXterm>[] = [];
  const ptys: PtySession[] = [];
  const streams: PayloadWindow[] = [];
  let renderEvents = 0;
  const done: Promise<void>[] = [];
  const barriers: PayloadCompletion[] = [];
  let sampler: ReturnType<typeof sampleAnimationFrames> | null = null;
  let start = performance.now();
  let error: string | undefined;
  const previousStyle = stage.style.cssText;
  stage.replaceChildren();
  stage.style.display = "flex";
  stage.style.flexWrap = "wrap";
  try {
    for (let i = 0; i < sessions; i++) {
      const surface = labXterm(stage, font, cols, rows, sessions);
      surfaces.push(surface);
      const stream = new PayloadWindow(fixture.bytes);
      streams.push(stream);
      const completion = new PayloadCompletion(
        fixture.bytes,
        () => stream.received,
      );
      barriers.push(completion);
      done.push(completion.done);
      surface.term.onRender(() => {
        renderEvents++;
        completion.rendered();
      });
      const pty = await openLabPty(cols, rows, {
        onData: (bytes) => {
          const payload = stream.push(bytes);
          if (!payload.length) return;
          const last = stream.received === fixture.bytes;
          surface.term.write(payload, () => {
            if (last) {
              completion.parsed();
              surface.term.refresh(0, rows - 1);
            }
          });
        },
        onExit: (code) => {
          completion.exit(code);
        },
      });
      ptys.push(pty);
    }
    sampler = sampleAnimationFrames();
    renderEvents = 0;
    start = performance.now();
    const script = `stty -echo -onlcr; printf '\\033]777;terax-lab-payload\\007'; cat ${shellQuote(fixture.path)}`;
    await Promise.all(
      ptys.map((pty) => pty.write(`exec /bin/sh -c ${shellQuote(script)}\r`)),
    );
    await bounded(Promise.all(done), 180_000, "xterm flood");
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const wallMs = performance.now() - start;
  const stamps = sampler?.stop() ?? [];
  const bytesReceived = streams.reduce((sum, s) => sum + s.received, 0);
  await Promise.all(ptys.map((pty) => pty.close().catch(() => {})));
  for (const barrier of barriers) barrier.dispose();
  for (const surface of surfaces) surface.dispose();
  stage.style.cssText = previousStyle;
  return {
    kind,
    sessions,
    megabytesPerSession: megabytes,
    cols,
    rows,
    payloadBytesPerSession: fixture.bytes,
    bytesReceived,
    wallMs,
    bytesPerSecond: perSecond(bytesReceived, wallMs),
    renderEvents,
    renderEventsPerSecondPerSession: perSecond(renderEvents / sessions, wallMs),
    animationFrameIntervalMs: distribution(intervals(stamps)),
    transport: "pty_open",
    renderer: "xterm-webgl",
    error,
  };
}
