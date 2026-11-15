import { ensureMonoFontsLoaded } from "@/lib/fonts";
import { engineAvailable } from "@/modules/terminal/gl/engineSession";
import type { TerminalRenderer } from "@/modules/terminal/gl/gridRenderer";
import { createTerminalRenderer } from "@/modules/terminal/gl/createTerminalRenderer";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  nativeTerminalRequested,
  NativeSurfaceContext,
} from "@/modules/terminal/gl/nativeSurfaceContext";
import {
  useTerminalEngineColors,
  useTerminalEngineFont,
} from "@/modules/terminal/gl/useTerminalEngineAppearance";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** One canvas/context/atlas for all ordinary terminal tabs and split panes. */
export function NativeTerminalSurface({ children }: { children: ReactNode }) {
  if (!nativeTerminalRequested)
    return <div className="relative h-full w-full">{children}</div>;
  return <ActiveNativeTerminalSurface>{children}</ActiveNativeTerminalSurface>;
}

function ActiveNativeTerminalSurface({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const currentRenderer = useRef<TerminalRenderer | null>(null);
  const listeners = useRef(new Set<() => void>());
  const layoutFrame = useRef(0);
  const [renderer, setRenderer] = useState<TerminalRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preferWebgl = usePreferencesStore((p) => p.terminalWebglEnabled);
  const [softwareAfterLoss, setSoftwareAfterLoss] = useState(false);
  const webgl = preferWebgl && !softwareAfterLoss;
  useEffect(() => {
    if (!preferWebgl) setSoftwareAfterLoss(false);
  }, [preferWebgl]);
  const font = useTerminalEngineFont();
  const colors = useTerminalEngineColors();
  const appearance = useRef({ font, colors });
  appearance.current = { font, colors };
  const scheduleLayout = useCallback(() => {
    if (layoutFrame.current) return;
    layoutFrame.current = requestAnimationFrame(() => {
      layoutFrame.current = 0;
      const box = root.current?.getBoundingClientRect();
      if (!box || box.width <= 0 || box.height <= 0) return;
      currentRenderer.current?.resize(box.width, box.height);
      for (const listener of Array.from(listeners.current)) listener();
    });
  }, []);
  const subscribeLayout = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!root.current) return;
    const element = root.current;
    let canvas: HTMLCanvasElement | null = null;
    let disposed = false;
    const makeCanvas = () => {
      if (disposed) throw new Error("Terminal presentation closed");
      canvas?.remove();
      const next = document.createElement("canvas");
      next.setAttribute("aria-hidden", "true");
      next.tabIndex = -1;
      next.setAttribute("data-native-terminal-canvas", "");
      next.setAttribute("data-terax-capture-proxy-source", "");
      next.className = "pointer-events-none absolute inset-0 h-full w-full";
      element.prepend(next);
      canvas = next;
      return next;
    };
    const lost = () => {
      if (!disposed && webgl) setSoftwareAfterLoss(true);
    };
    setError(null);
    setRenderer(null);
    let opened: TerminalRenderer | null = null;
    const resize = new ResizeObserver(scheduleLayout);
    resize.observe(root.current);
    void (async () => {
      try {
        const available = await engineAvailable();
        if (disposed) return;
        if (!available)
          throw new Error(
            "Native terminal engine is unavailable in this build.",
          );
        await ensureMonoFontsLoaded();
        if (disposed) return;
        const { font: currentFont, colors: currentColors } = appearance.current;
        opened = await createTerminalRenderer(
          makeCanvas,
          {
            font: currentFont,
            background: currentColors.background,
            cursorFallback: currentColors.cursor,
            onMetricsChange: scheduleLayout,
          },
          webgl,
        );
        if (disposed) {
          opened.dispose();
          return;
        }
        opened.canvas.setAttribute(
          "data-native-terminal-renderer",
          opened.backend,
        );
        if (opened.backend === "webgl")
          opened.canvas.addEventListener("webglcontextlost", lost);
        currentRenderer.current = opened;
        setRenderer(opened);
        scheduleLayout();
      } catch (cause) {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      disposed = true;
      resize.disconnect();
      if (layoutFrame.current) cancelAnimationFrame(layoutFrame.current);
      layoutFrame.current = 0;
      currentRenderer.current = null;
      opened?.canvas.removeEventListener("webglcontextlost", lost);
      opened?.dispose();
      canvas?.remove();
    };
  }, [scheduleLayout, webgl]);

  useEffect(() => {
    renderer?.setFont(font);
  }, [renderer, font]);
  useEffect(() => {
    renderer?.setBackground(colors.background, colors.cursor);
  }, [renderer, colors]);
  const value = useMemo(
    () => ({ renderer, root, font, colors, error, subscribeLayout }),
    [renderer, font, colors, error, subscribeLayout],
  );
  return (
    <NativeSurfaceContext.Provider value={value}>
      <div ref={root} className="relative h-full w-full">
        {children}
      </div>
    </NativeSurfaceContext.Provider>
  );
}
