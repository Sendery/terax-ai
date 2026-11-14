import { LabCreditBatcher } from "@/terminal-lab/lib/creditBatch";
import { StageProfile } from "@/terminal-lab/lib/stageProfile";
import { benchGeometry } from "@/terminal-lab/lib/benchGeometry";
import {
  FrameTimeline,
  summarizeConcurrentTimelines,
  type FrameTimelineReport,
  type ConcurrentTimelineSummary,
  type TimelineCompleteness,
} from "@/terminal-lab/lib/frameTimeline";
import {
  type BenchKind,
  type BenchStats,
  EngineSession,
  registerLabCredits,
} from "@/modules/terminal/gl/engineSession";
import type { LabColors } from "@/terminal-lab/lib/useLabAppearance";
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

export type BenchOptions = { profile: boolean; batchCredits?: boolean };

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
  timelines?: FrameTimelineReport[];
  concurrent?: ConcurrentTimelineSummary;
  completeness?: TimelineCompleteness[];
  geometry?: Record<string, unknown>;
  contextLosses?: number;
  atlasResets?: number;
  profile?: ReturnType<StageProfile["toJSON"]>;
  profileDrainMs?: number;
  creditBatch?: ReturnType<LabCreditBatcher["snapshot"]>;
  error?: string;
};

function sumStats(stats: (BenchStats | null)[]): BenchRun["rustTotals"] {
  const total = {
    bytesFed: 0,
    frames: 0,
    frameBytes: 0,
    encodeMicros: 0,
    sendMicros: 0,
    creditWaitMicros: 0,
    credits: 0,
    scrollbackRows: 0 as number | null,
  };
  for (const s of stats) {
    if (!s) continue;
    total.bytesFed += s.bytesFed;
    total.frames += s.frames;
    total.frameBytes += s.frameBytes;
    total.encodeMicros += s.encodeMicros;
    total.sendMicros += s.sendMicros;
    total.creditWaitMicros += s.creditWaitMicros;
    total.credits += s.credits;
    total.scrollbackRows =
      total.scrollbackRows === null || s.scrollbackRows === null
        ? null
        : total.scrollbackRows + s.scrollbackRows;
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
  colors: LabColors,
  kind: BenchKind,
  sessions: number,
  megabytes: number,
  options?: BenchOptions,
): Promise<BenchRun> {
  const profile = options?.profile ? new StageProfile() : null;
  const creditBatch = options?.batchCredits ? new LabCreditBatcher(registerLabCredits) : null;
  const cols = sessions === 1 ? 200 : 100;
  const rows = sessions === 1 ? 60 : 30;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  stage.replaceChildren(canvas);
  const box = stage.getBoundingClientRect();
  const timelines = Array.from(
    { length: sessions },
    (_, i) => new FrameTimeline(i),
  );
  const opened: (EngineSession | null)[] = Array(sessions).fill(null);
  const exits: Promise<void>[] = [];
  const errors: string[] = [];
  const roundTrips: number[] = [];
  let renderer: GridRenderer | null = null;
  let geometry: Record<string, unknown> | undefined;
  let frames = 0;
  let frameBytes = 0;
  let decodeErrors = 0;
  const sampler = sampleAnimationFrames();
  const start = performance.now();
  let rust: (BenchStats | null)[] = [];
  let timedOut = false;

  try {
    try {
      const active = new GridRenderer(canvas, {
        font,
        background: colors.background,
        cursorFallback: colors.cursor,
        onDrawTiming: profile
          ? (at, ms, panes) => profile.render(at, ms, panes)
          : undefined,
      });
      renderer = active;
      const layout = benchGeometry(cols, rows, sessions, active.cellSize);
      const dpr = window.devicePixelRatio || 1;
      if (layout.width * layout.height * dpr * dpr > 64_000_000)
        throw new Error(
          "benchmark backbuffer exceeds 64 million pixels; workload was not reduced",
        );
      active.resize(layout.width, layout.height);
      geometry = {
        rasterization: "full-native-grid-css-scaled",
        cell: active.cellSize,
        logicalWidth: layout.width,
        logicalHeight: layout.height,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        stageWidth: box.width,
        stageHeight: box.height,
        displayScaleX: box.width / layout.width,
        displayScaleY: box.height / layout.height,
        devicePixelRatio: dpr,
        panes: layout.panes,
      };
      const opening = timelines.map((timeline, index) => {
        let creditAt: number | null = null;
        let resolveExit = () => {};
        exits.push(
          new Promise<void>((resolve) => {
            resolveExit = resolve;
          }),
        );
        return EngineSession.openBench(active, {
          kind,
          megabytes,
          sendCredit: creditBatch?.send,
          colors: colors.engine,
          cols,
          rows,
          observer: {
            onFrameTiming: profile
              ? (timing) => profile.frame(index, timing)
              : undefined,
            onCreditReply: profile
              ? (seq, at, ok) => profile.reply(index, seq, at, ok)
              : undefined,
            onFrame: (event) => {
              frames += 1;
              frameBytes += event.bytes;
              if (!event.frame) decodeErrors += 1;
              timeline.received(event.seq, event.bytes, event.receivedAt);
              if (creditAt !== null) {
                roundTrips.push(event.receivedAt - creditAt);
                creditAt = null;
              }
            },
            onDrawn: (at, seq) => {
              if (seq !== null) {
                timeline.drawn(seq, at);
                profile?.drawn(index, seq, at);
              }
            },
            onCredit: (seq, at) => {
              timeline.credited(seq, at);
              profile?.credit(index, seq, at);
              creditAt = at;
            },
            onError: (error) =>
              errors.push(`session ${index}: ${String(error)}`),
            onExit: (code) => {
              if (code !== 0) errors.push(`session ${index} exited ${code}`);
              resolveExit();
            },
          },
        }).then((session) => {
          opened[index] = session;
          active.setPaneRect(session.pane, layout.panes[index]);
          return session;
        });
      });
      for (const result of await Promise.allSettled(opening))
        if (result.status === "rejected") throw result.reason;
      timedOut = await Promise.race([
        Promise.all(exits).then(() => false),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(true), RUN_TIMEOUT_MS),
        ),
      ]);
      rust = await Promise.all(
        opened.map(
          (session) => session?.benchStats().catch(() => null) ?? null,
        ),
      );
      if (!timedOut) {
        const deadline = performance.now() + 5000;
        const complete = () =>
          timelines.every((timeline, i) => {
            const stats = rust[i];
            return (
              stats !== null &&
              stats !== undefined &&
              timeline.completeness(stats).complete
            );
          });
        while (!complete() && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 16));
        if (!complete())
          errors.push("engine final-frame receive/draw barrier failed");
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    const finishedAt = performance.now();
    const wallMs = finishedAt - start;
    const stamps = sampler.stop();
    const rendererDraws = renderer?.stats.draws ?? 0;
    profile?.stop(finishedAt);
    if (profile || creditBatch) {
      const deadline = finishedAt + 5000;
      while (((profile?.pendingReplies ?? 0) > 0 || (creditBatch?.pendingCount ?? 0) > 0) && performance.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 16));
    }
    const profileDrainMs = profile || creditBatch ? performance.now() - finishedAt : undefined;
    const batchStats = creditBatch?.snapshot();
    if (batchStats && (!batchStats.complete || batchStats.queued !== frames))
      errors.push("incomplete credit batch registration");
    const stageProfile = profile?.toJSON();
    if (stageProfile && !stageProfile.complete)
      errors.push("incomplete stage profile", ...stageProfile.errors);
    const completeness = timelines.map((timeline, i) =>
      timeline.completeness(rust[i] ?? { frames: 0, frameBytes: 0 }),
    );
    for (const [i, completion] of completeness.entries())
      for (const error of completion.errors)
        errors.push(`session ${i}: ${error}`);
    if (renderer?.stats.contextLosses)
      errors.push(`${renderer.stats.contextLosses} WebGL context losses`);
    const result: BenchRun = {
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
      rendererDraws,
      atlasGlyphs: renderer?.atlasInfo.glyphs ?? 0,
      rust,
      rustTotals: sumStats(rust),
      timelines: timelines.map((timeline) => timeline.toJSON()),
      concurrent: summarizeConcurrentTimelines(timelines),
      completeness,
      geometry,
      contextLosses: renderer?.stats.contextLosses ?? 0,
      atlasResets: renderer?.stats.atlasResets ?? 0,
      profile: stageProfile,
      profileDrainMs,
      creditBatch: batchStats,
      error: errors.length ? errors.join("; ") : undefined,
    };
    return result;
  } finally {
    creditBatch?.close();
    sampler.stop();
    await Promise.all(
      opened.map((session) => session?.close().catch(() => {})),
    );
    renderer?.dispose();
    canvas.remove();
  }
}
