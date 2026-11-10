import { EngineSession, labStatus } from "@/modules/terminal/gl/engineSession";
import {
  GridRenderer,
  type RendererFont,
} from "@/modules/terminal/gl/gridRenderer";
import { openPty, type PtySession } from "@/modules/terminal/lib/pty-bridge";
import {
  type AutorunConfig,
  idleCommand,
  IDLE_LINES,
  requireIdleScrollback,
  sleep,
} from "@/terminal-lab/lib/autorun";
import { FrameWatchers } from "@/terminal-lab/lib/echo";
import { bounded, labXterm } from "@/terminal-lab/lib/labXterm";
import type { LabColors } from "@/terminal-lab/lib/useLabAppearance";

export async function runIdle(
  stage: HTMLElement,
  font: RendererFont,
  colors: LabColors,
  config: AutorunConfig,
) {
  const sessions: (EngineSession | PtySession)[] = [];
  const surfaces: ReturnType<typeof labXterm>[] = [];
  let renderer: GridRenderer | null = null;
  const cols = 100;
  const rows = 30;
  const ready: Promise<unknown>[] = [];
  const previousStyle = stage.style.cssText;
  stage.replaceChildren();
  const startedAt = new Date().toISOString();
  try {
    if (config.mode === "idle-engine") {
      const canvas = document.createElement("canvas");
      stage.appendChild(canvas);
      renderer = new GridRenderer(canvas, {
        font,
        background: colors.background,
        cursorFallback: colors.cursor,
      });
      const box = stage.getBoundingClientRect();
      renderer.resize(box.width, box.height);
      for (let i = 0; i < config.count; i++) {
        const watchers = new FrameWatchers();
        const session = await EngineSession.open(renderer, {
          cols,
          rows,
          colors: colors.engine,
          observer: watchers.observer,
        });
        sessions.push(session);
        renderer.setPaneRect(session.pane, {
          x: ((i % 4) * box.width) / 4,
          y: (Math.floor(i / 4) * box.height) / Math.ceil(config.count / 4),
          width: box.width / 4,
          height: box.height / Math.ceil(config.count / 4),
        });
        const drawn = watchers.waitForCell(0, 0, 84, 30_000).then((at) => {
          if (at === null)
            throw new Error(`idle engine ${i} did not draw readiness marker`);
        });
        void drawn.catch(() => {});
        ready.push(drawn);
        await session.write(idleCommand(rows));
      }
    } else {
      stage.style.display = "flex";
      stage.style.flexWrap = "wrap";
      for (let i = 0; i < config.count; i++) {
        const surface = labXterm(stage, font, cols, rows, config.count);
        surfaces.push(surface);
        let resolveReady = () => {};
        ready.push(
          new Promise<void>((resolve) => {
            resolveReady = resolve;
          }),
        );
        surface.term.onRender(() => {
          const buffer = surface.term.buffer.active;
          if (
            buffer
              .getLine(buffer.baseY)
              ?.translateToString()
              .startsWith("TERAX_IDLE_READY")
          )
            resolveReady();
        });
        const pty = await openPty(cols, rows, {
          onData: (data) => surface.term.write(data),
        });
        sessions.push(pty);
        await pty.write(idleCommand(rows));
      }
    }
    await bounded(Promise.all(ready), 45_000, "idle scrollback setup");
    await sleep(2000);
    const engineScrollbackLines =
      config.mode === "idle-engine"
        ? await Promise.all(
            sessions.map(
              async (session) =>
                (await (session as EngineSession).benchStats()).scrollbackRows,
            ),
          )
        : [];
    const xtermScrollbackLines = surfaces.map(
      (s) => s.term.buffer.active.baseY,
    );
    const measuredScrollbackRows =
      config.mode === "idle-engine"
        ? engineScrollbackLines
        : xtermScrollbackLines;
    requireIdleScrollback(measuredScrollbackRows, config.count);
    const status = {
      mode: config.mode,
      sessions: config.count,
      cols,
      rows,
      expectedScrollbackLines: IDLE_LINES,
      measuredScrollbackRows,
      scrollbackVerified: true,
      startedAt,
      readyAt: new Date().toISOString(),
      holdMs: config.holdMs,
      sessionIds: sessions.map((s) => s.id),
      engineScrollbackLines,
      xtermScrollbackLines,
    };
    await labStatus({ ...status, status: "idle-ready" });
    await sleep(config.holdMs);
    return status;
  } finally {
    await Promise.all(sessions.map((s) => s.close().catch(() => {})));
    for (const surface of surfaces) surface.dispose();
    renderer?.dispose();
    stage.replaceChildren();
    stage.style.cssText = previousStyle;
  }
}
