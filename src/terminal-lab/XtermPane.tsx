import type { RendererFont } from "@/modules/terminal/gl/gridRenderer";
import { openPty, type PtySession } from "@/modules/terminal/lib/pty-bridge";
import { useTheme } from "@/modules/theme";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { cellMatches, type EchoTarget } from "@/terminal-lab/lib/echo";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

type Props = {
  font: RendererFont;
  onTarget: (target: EchoTarget | null) => void;
};

type Watch = {
  x: number;
  y: number;
  codepoint: number;
  seen: boolean;
  resolve: (at: number | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** The existing path, xterm.js on `pty_open`, for side by side comparison. */
export function XtermPane({ font, onTarget }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const initial = useRef({ font, onTarget });
  const [status, setStatus] = useState("starting");
  const { activeTheme, resolvedMode } = useTheme();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { font, onTarget } = initial.current;
    const term = new Terminal({
      fontFamily: font.family,
      fontWeight: font.weight as Terminal["options"]["fontWeight"],
      fontSize: font.size,
      letterSpacing: font.letterSpacing,
      theme: buildTerminalTheme(),
      cursorStyle: "bar",
      scrollback: 10_000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      term.loadAddon(new WebglAddon());
    } catch (error) {
      console.error("terminal lab xterm webgl:", error);
    }
    fit.fit();
    termRef.current = term;

    const watches = new Set<Watch>();
    const finish = (watch: Watch, at: number | null) => {
      if (!watches.delete(watch)) return;
      clearTimeout(watch.timer);
      watch.resolve(at);
    };
    const cellAt = (x: number, y: number): number => {
      const buffer = term.buffer.active;
      const chars =
        buffer
          .getLine(buffer.baseY + y)
          ?.getCell(x)
          ?.getChars() ?? "";
      return chars.codePointAt(0) ?? 0;
    };
    const parsed = term.onWriteParsed(() => {
      for (const watch of watches) {
        if (
          !watch.seen &&
          cellMatches(cellAt(watch.x, watch.y), watch.codepoint)
        ) {
          watch.seen = true;
        }
      }
    });
    const rendered = term.onRender(() => {
      const at = performance.now();
      for (const watch of watches) if (watch.seen) finish(watch, at);
    });

    let pty: PtySession | null = null;
    let disposed = false;
    const input = term.onData((data) => {
      void pty?.write(data);
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      void pty?.resize(term.cols, term.rows);
    });
    observer.observe(host);

    openPty(term.cols, term.rows, {
      onData: (bytes) => term.write(bytes),
      onExit: (code) => setStatus(`exited with ${code}`),
    }).then(
      (opened) => {
        if (disposed) {
          void opened.close().catch(() => {});
          return;
        }
        pty = opened;
        setStatus(`session ${opened.id}`);
        onTarget({
          cursor: () => ({
            x: term.buffer.active.cursorX,
            y: term.buffer.active.cursorY,
          }),
          write: (text) => opened.write(text),
          waitForCell: (x, y, codepoint, timeoutMs) =>
            new Promise((resolve) => {
              const watch: Watch = {
                x,
                y,
                codepoint,
                seen: false,
                resolve,
                timer: setTimeout(() => finish(watch, null), timeoutMs),
              };
              watches.add(watch);
            }),
        });
      },
      (error) => {
        if (!disposed) setStatus(`failed: ${String(error)}`);
      },
    );

    return () => {
      disposed = true;
      onTarget(null);
      observer.disconnect();
      parsed.dispose();
      rendered.dispose();
      input.dispose();
      for (const watch of watches) finish(watch, null);
      void pty?.close().catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = font.family;
    term.options.fontSize = font.size;
    term.options.fontWeight = font.weight as Terminal["options"]["fontWeight"];
    term.options.letterSpacing = font.letterSpacing;
  }, [font]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme is the re-read trigger
  useEffect(() => {
    // The provider applies the theme's variables after this effect runs.
    const id = requestAnimationFrame(() => {
      if (termRef.current) termRef.current.options.theme = buildTerminalTheme();
    });
    return () => cancelAnimationFrame(id);
  }, [activeTheme, resolvedMode]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
      <header className="flex items-center justify-between text-muted-foreground">
        <span className="font-medium text-foreground">xterm.js (pty_open)</span>
        <span>{status}</span>
      </header>
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border p-1.5"
      />
    </section>
  );
}
