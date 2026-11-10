import {
  attachInput,
  EngineSession,
} from "@/modules/terminal/gl/engineSession";
import {
  GridRenderer,
  type RendererFont,
} from "@/modules/terminal/gl/gridRenderer";
import { gridFor } from "@/modules/terminal/gl/keyInput";
import { type EchoTarget, FrameWatchers } from "@/terminal-lab/lib/echo";
import type { LabColors } from "@/terminal-lab/lib/useLabAppearance";
import { useEffect, useRef, useState } from "react";

const PADDING = 6;

type Props = {
  font: RendererFont;
  colors: LabColors;
  onTarget: (target: EchoTarget | null) => void;
};

/** A real shell on the Rust engine, drawn by the WebGL2 renderer. */
export function EnginePane({ font, colors, onTarget }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GridRenderer | null>(null);
  const initial = useRef({ font, colors, onTarget });
  const latestColors = useRef(colors);
  latestColors.current = colors;
  const sessionRef = useRef<EngineSession | null>(null);
  const [status, setStatus] = useState("starting");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { font, colors, onTarget } = initial.current;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    host.appendChild(canvas);
    let renderer: GridRenderer;
    try {
      renderer = new GridRenderer(canvas, {
        font,
        background: colors.background,
        cursorFallback: colors.cursor,
        onMetricsChange: () => scheduleLayout(),
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      canvas.remove();
      return;
    }
    rendererRef.current = renderer;
    const watchers = new FrameWatchers();
    let session: EngineSession | null = null;
    let input: { dispose: () => void; focus: () => void } | null = null;
    let disposed = false;
    let layoutFrame = 0;

    const box = () => {
      const rect = host.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        inner: {
          x: PADDING,
          y: PADDING,
          width: Math.max(0, rect.width - PADDING * 2),
          height: Math.max(0, rect.height - PADDING * 2),
        },
      };
    };
    const layout = () => {
      layoutFrame = 0;
      if (disposed) return;
      const { width, height, inner } = box();
      renderer.resize(width, height);
      if (!session) return;
      renderer.setPaneRect(session.pane, inner);
      const grid = gridFor(inner.width, inner.height, renderer.cellSize);
      session.resize(grid.cols, grid.rows);
    };
    function scheduleLayout() {
      if (!layoutFrame) layoutFrame = requestAnimationFrame(layout);
    }
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(host);

    const { width, height, inner } = box();
    renderer.resize(width, height);
    const grid = gridFor(inner.width, inner.height, renderer.cellSize);
    EngineSession.open(renderer, {
      cols: grid.cols,
      rows: grid.rows,
      colors: colors.engine,
      observer: {
        onFrame: watchers.observer.onFrame,
        onDrawn: watchers.observer.onDrawn,
        onExit: (code) => setStatus(`exited with ${code}`),
        onError: (error) => console.error("terminal lab engine:", error),
      },
    }).then(
      (opened) => {
        if (disposed) {
          void opened.close().catch(() => {});
          return;
        }
        session = opened;
        sessionRef.current = opened;
        if (latestColors.current !== colors)
          opened.setColors(latestColors.current.engine);
        // The box may have changed while the session was opening.
        scheduleLayout();
        input = attachInput(opened, renderer, host);
        input.focus();
        setStatus(`session ${opened.id}`);
        onTarget({
          cursor: () => opened.cursor,
          write: (text) => opened.write(text),
          waitForCell: (x, y, cp, timeout) =>
            watchers.waitForCell(x, y, cp, timeout),
        });
      },
      (error) => {
        if (!disposed) setStatus(`failed: ${String(error)}`);
      },
    );

    return () => {
      disposed = true;
      sessionRef.current = null;
      onTarget(null);
      observer.disconnect();
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      input?.dispose();
      void session?.close().catch(() => {});
      renderer.dispose();
      rendererRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setFont(font);
  }, [font]);

  useEffect(() => {
    rendererRef.current?.setBackground(colors.background, colors.cursor);
    sessionRef.current?.setColors(colors.engine);
  }, [colors]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
      <header className="flex items-center justify-between text-muted-foreground">
        <span className="font-medium text-foreground">
          Engine (libghostty-vt + WebGL2)
        </span>
        <span>{status}</span>
      </header>
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border"
      />
    </section>
  );
}
