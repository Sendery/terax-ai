import {
  type BenchKind,
  type BenchStats,
  EngineSession,
} from "@/modules/terminal/gl/engineSession";
import {
  GridRenderer,
  type RendererFont,
} from "@/modules/terminal/gl/gridRenderer";
import {
  type Distribution,
  distribution,
  intervals,
  perSecond,
  sampleAnimationFrames,
} from "@/terminal-lab/lib/stats";

export const BENCH_KINDS: readonly BenchKind[] = ["ascii", "sgr", "tui"];
export const BENCH_SESSION_COUNTS = [1, 12] as const;

/** Megabytes fed to each session, sized so every run lasts a few seconds. */
export const DEFAULT_MEGABYTES: Record<
  BenchKind,
  [single: number, each: number]
> = {
  ascii: [256, 32],
  sgr: [48, 8],
  tui: [96, 16],
};

const RUN_TIMEOUT_MS = 180_000;

export type BenchRun = {
  kind: BenchKind;
  sessions: number;
  megabytesPerSession: number;
  cols: number;
  rows: number;
  wallMs: number;
  timedOut: boolean;
  frames: number;
  framesPerSecond: number | null;
  framesPerSecondPerSession: number | null;
  frameBytes: number;
  bytesPerSecond: number | null;
  animationFrameIntervalMs: Distribution;
  creditRoundTripMs: Distribution;
  decodeErrors: number;
  rendererDraws: number;
  atlasGlyphs: number;
  rust: (BenchStats | null)[];
  rustTotals: BenchStats & { encodeMicrosPerFrame: number | null };
  error?: string;
};

function layout(sessions: number): { across: number; down: number } {
  return sessions === 1 ? { across: 1, down: 1 } : { across: 4, down: 3 };
}

function sumStats(stats: (BenchStats | null)[]): BenchRun["rustTotals"] {
  const total = {
    bytesFed: 0,
    frames: 0,
    frameBytes: 0,
    encodeMicros: 0,
    creditWaitMicros: 0,
  };
  for (const s of stats) {
    if (!s) continue;
    total.bytesFed += s.bytesFed;
    total.frames += s.frames;
    total.frameBytes += s.frameBytes;
    total.encodeMicros += s.encodeMicros;
    total.creditWaitMicros += s.creditWaitMicros;
  }
  return {
    ...total,
    encodeMicrosPerFrame:
      total.frames > 0
        ? Math.round((total.encodeMicros / total.frames) * 10) / 10
        : null,
  };
}

/**
 * Runs `sessions` bench sessions of one payload kind as panes of one canvas
 * inside `stage`, and measures delivery, credits and the main thread's frame
 * pacing while they run.
 */
export async function runBench(
  stage: HTMLElement,
  font: RendererFont,
  colors: { background: number; cursor: number },
  kind: BenchKind,
  sessions: number,
  megabytes: number,
): Promise<BenchRun> {
  const cols = sessions === 1 ? 200 : 100;
  const rows = sessions === 1 ? 60 : 30;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  stage.replaceChildren(canvas);
  const box = stage.getBoundingClientRect();
  const renderer = new GridRenderer(canvas, {
    font,
    background: colors.background,
    cursorFallback: colors.cursor,
  });
  renderer.resize(box.width, box.height);

  let frames = 0;
  let frameBytes = 0;
  let decodeErrors = 0;
  const roundTrips: number[] = [];
  const opened: EngineSession[] = [];
  const exits: Promise<void>[] = [];
  const { across, down } = layout(sessions);
  const paneW = box.width / across;
  const paneH = box.height / down;
  const sampler = sampleAnimationFrames();
  const start = performance.now();
  let error: string | undefined;

  try {
    const opening = Array.from({ length: sessions }, (_, index) => {
      let creditAt: number | null = null;
      let resolveExit = () => {};
      exits.push(
        new Promise<void>((resolve) => {
          resolveExit = resolve;
        }),
      );
      return EngineSession.openBench(renderer, {
        kind,
        megabytes,
        cols,
        rows,
        observer: {
          onFrame: (event) => {
            frames += 1;
            frameBytes += event.bytes;
            if (!event.frame) decodeErrors += 1;
            if (creditAt !== null) {
              roundTrips.push(event.receivedAt - creditAt);
              creditAt = null;
            }
          },
          onCredit: (_seq, at) => {
            creditAt = at;
          },
          onExit: () => resolveExit(),
        },
      }).then((session) => {
        opened.push(session);
        renderer.setPaneRect(session.pane, {
          x: (index % across) * paneW,
          y: Math.floor(index / across) * paneH,
          width: paneW,
          height: paneH,
        });
        return session;
      });
    });
    const settled = await Promise.allSettled(opening);
    for (const result of settled) {
      if (result.status === "rejected") throw result.reason;
    }
    const timedOut = await Promise.race([
      Promise.all(exits).then(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(true), RUN_TIMEOUT_MS)),
    ]);
    const wallMs = performance.now() - start;
    const stamps = sampler.stop();
    const rust = await Promise.all(
      opened.map((s) => s.benchStats().catch(() => null)),
    );
    return {
      kind,
      sessions,
      megabytesPerSession: megabytes,
      cols,
      rows,
      wallMs: Math.round(wallMs),
      timedOut,
      frames,
      framesPerSecond: perSecond(frames, wallMs),
      framesPerSecondPerSession: perSecond(frames / sessions, wallMs),
      frameBytes,
      bytesPerSecond: perSecond(frameBytes, wallMs),
      animationFrameIntervalMs: distribution(intervals(stamps)),
      creditRoundTripMs: distribution(roundTrips),
      decodeErrors,
      rendererDraws: renderer.stats.draws,
      atlasGlyphs: renderer.atlasInfo.glyphs,
      rust,
      rustTotals: sumStats(rust),
    };
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    const wallMs = performance.now() - start;
    sampler.stop();
    return {
      kind,
      sessions,
      megabytesPerSession: megabytes,
      cols,
      rows,
      wallMs: Math.round(wallMs),
      timedOut: false,
      frames,
      framesPerSecond: null,
      framesPerSecondPerSession: null,
      frameBytes,
      bytesPerSecond: null,
      animationFrameIntervalMs: distribution([]),
      creditRoundTripMs: distribution(roundTrips),
      decodeErrors,
      rendererDraws: renderer.stats.draws,
      atlasGlyphs: renderer.atlasInfo.glyphs,
      rust: [],
      rustTotals: sumStats([]),
      error,
    };
  } finally {
    await Promise.all(opened.map((s) => s.close().catch(() => {})));
    renderer.dispose();
    canvas.remove();
  }
}
