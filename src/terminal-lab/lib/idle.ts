import { benchGeometry } from "@/terminal-lab/lib/benchGeometry";
import { EngineSession, labStatus } from "@/modules/terminal/gl/engineSession";
import {
  GridRenderer,
  type RendererFont,
} from "@/modules/terminal/gl/gridRenderer";
import {
  type AutorunConfig,
  idleCommand,
  IDLE_LINES,
  requireIdleScrollback,
  sleep,
} from "@/terminal-lab/lib/autorun";
import { FrameWatchers } from "@/terminal-lab/lib/echo";
import type { LabColors } from "@/terminal-lab/lib/useLabAppearance";

function bounded<T>(promise: Promise<T>, ms: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runIdle(
  stage: HTMLElement,
  font: RendererFont,
  colors: LabColors,
  config: AutorunConfig,
) {
  const sessions: EngineSession[] = [];
  let renderer: GridRenderer | null = null;
  const cols = 100;
  const rows = 30;
  const ready: Promise<unknown>[] = [];
  const previousStyle = stage.style.cssText;
  stage.replaceChildren();
  const startedAt = new Date().toISOString();
  try {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    stage.appendChild(canvas);
    renderer = new GridRenderer(canvas, {
      font,
      background: colors.background,
      cursorFallback: colors.cursor,
    });
    const layout = benchGeometry(cols, rows, config.count, renderer.cellSize);
    renderer.resize(layout.width, layout.height);
    for (let i = 0; i < config.count; i++) {
      const watchers = new FrameWatchers();
      const session = await EngineSession.open(renderer, {
        cols,
        rows,
        colors: colors.engine,
        observer: watchers.observer,
      });
      sessions.push(session);
      renderer.setPaneRect(session.pane, layout.panes[i]);
      const drawn = watchers.waitForCell(0, 0, 84, 30_000).then((at) => {
        if (at === null)
          throw new Error(`idle engine ${i} did not draw readiness marker`);
      });
      void drawn.catch(() => {});
      ready.push(drawn);
      await session.write(idleCommand(rows));
    }
    await bounded(Promise.all(ready), 45_000, "idle scrollback setup");
    await sleep(2000);
    const engineScrollbackLines = await Promise.all(
      sessions.map(async (session) => (await session.benchStats()).scrollbackRows),
    );
    requireIdleScrollback(engineScrollbackLines, config.count);
    const status = {
      mode: config.mode,
      sessions: config.count,
      cols,
      rows,
      expectedScrollbackLines: IDLE_LINES,
      measuredScrollbackRows: engineScrollbackLines,
      scrollbackVerified: true,
      startedAt,
      readyAt: new Date().toISOString(),
      holdMs: config.holdMs,
      sessionIds: sessions.map((s) => s.id),
      engineScrollbackLines,
      canvasBackings: [...stage.querySelectorAll("canvas")].map((canvas) => ({
        width: canvas.width,
        height: canvas.height,
      })),
    };
    await labStatus({ ...status, status: "idle-ready" });
    await sleep(config.holdMs);
    return status;
  } finally {
    await Promise.all(sessions.map((s) => s.close().catch(() => {})));
    renderer?.dispose();
    stage.replaceChildren();
    stage.style.cssText = previousStyle;
  }
}
