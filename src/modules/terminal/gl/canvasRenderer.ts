import {
  NativeContrast,
  normalizeMinimumContrast,
} from "@/modules/terminal/gl/minimumContrast";
import {
  applyFrame,
  CELL_WORDS,
  GLYPH_SLOT_MASK,
  GLYPH_SKIP,
  GLYPH_WIDE,
  clearGlyphs,
  type ApplyResult,
} from "@/modules/terminal/gl/cellBuffer";
import { CanvasGraphics } from "@/modules/terminal/gl/canvasGraphics";
import {
  CURSOR_BLOCK,
  CURSOR_BAR,
  CURSOR_UNDERLINE,
  CURSOR_HIDDEN,
  CURSOR_HOLLOW_BLOCK,
  CURSOR_COLOR_NONE,
  FRAME_FLAG_CURSOR_BLINK,
  FRAME_FLAG_SCROLLED_BACK,
  type DecodedFrame,
} from "@/modules/terminal/gl/frameCodec";
import {
  fontString,
  measureCell,
  type AtlasFont,
  type CellMetrics,
} from "@/modules/terminal/gl/glyphAtlas";
import type {
  GridRendererOptions,
  TerminalRenderer,
  PaneCallbacks,
  PaneRect,
  RendererFont,
  RenderPane,
} from "@/modules/terminal/gl/gridRenderer";
import { RenderCapacityError } from "@/modules/terminal/gl/renderCapacity";

const MAX_KEYS = 65536,
  MAX_KEY_BYTES = 8 * 1024 * 1024;
const css = (value: number) =>
  "rgb(" +
  (value & 255) +
  "," +
  ((value >>> 8) & 255) +
  "," +
  ((value >>> 16) & 255) +
  ")";
type Glyph = { text: string; face: number };
export class CanvasRenderer implements TerminalRenderer {
  readonly backend = "canvas";
  readonly canvas: HTMLCanvasElement;
  readonly stats = {
    draws: 0,
    lastDrawMs: 0,
    contextLosses: 0,
    atlasResets: 0,
  };
  private context: CanvasRenderingContext2D;
  private font: RendererFont;
  private metrics: CellMetrics;
  private dpr: number;
  private background: number;
  private minimumContrast?: NativeContrast;
  private cursorFallback: number | undefined;
  private panes: RenderPane[] = [];
  private glyphs: Glyph[] = [];
  private keys = new Map<string, number>();
  private keyBytes = 0;
  private graphics: CanvasGraphics | undefined;
  private rafId = 0;
  private disposed = false;
  private blinkOn = true;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private dprQuery: MediaQueryList | null = null;
  private retried = new Set<RenderPane>();
  private blocked = new Set<RenderPane>();
  private pending = new Set<RenderPane>();
  constructor(
    canvas: HTMLCanvasElement,
    private readonly options: GridRendererOptions,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("2D canvas unavailable");
    this.canvas = canvas;
    this.context = context;
    this.font = options.font;
    this.background = options.background;
    const contrast = normalizeMinimumContrast(options.minimumContrastRatio);
    this.minimumContrast =
      contrast > 1 ? new NativeContrast(contrast) : undefined;
    this.cursorFallback = options.cursorFallback;
    this.dpr = window.devicePixelRatio || 1;
    this.metrics = measureCell(this.atlasFont());
    this.watchDpr();
  }
  get cellSize() {
    return {
      width: this.metrics.width / this.dpr,
      height: this.metrics.height / this.dpr,
    };
  }
  get cellPixels() {
    return { width: this.metrics.width, height: this.metrics.height };
  }
  get atlasInfo() {
    return { glyphs: this.glyphs.length, textureBytes: 0 };
  }
  addPane(callbacks: PaneCallbacks): RenderPane {
    const pane: RenderPane = {
      callbacks,
      rect: { x: 0, y: 0, width: 0, height: 0 },
      grid: null,
      header: null,
      focused: true,
      vao: null,
      vbo: null,
      gpuCells: 0,
      undrawn: false,
    };
    this.panes.push(pane);
    return pane;
  }
  removePane(pane: RenderPane): void {
    const index = this.panes.indexOf(pane);
    if (index < 0) return;
    this.panes.splice(index, 1);
    this.graphics?.remove(pane);
    pane.grid = null;
    pane.header = null;
    this.retried.delete(pane);
    this.blocked.delete(pane);
    this.pending.delete(pane);
    this.completeRecovery();
    this.updateBlink();
    this.requestDraw();
  }
  setPaneRect(pane: RenderPane, rect: PaneRect): void {
    const wasVisible = pane.rect.width > 0 && pane.rect.height > 0;
    pane.rect = rect;
    if (rect.width <= 0 || rect.height <= 0) {
      pane.grid = null;
      pane.header = null;
      pane.needsVisibleFull = true;
      this.graphics?.remove(pane);
      this.pending.delete(pane);
      if (wasVisible && this.blocked.size) this.retryCapacity();
      this.completeRecovery();
      this.updateBlink();
    } else if (pane.needsVisibleFull) {
      pane.needsVisibleFull = false;
      pane.undrawn = true;
      pane.callbacks.onNeedFullFrame();
    }
    this.requestDraw();
  }
  setPaneFocused(pane: RenderPane, focused: boolean): void {
    if (pane.focused !== focused) {
      pane.focused = focused;
      this.requestDraw();
    }
  }
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width * this.dpr)),
      h = Math.max(1, Math.round(height * this.dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.requestDraw();
  }
  setBackground(color: number, cursorFallback?: number): void {
    this.background = color;
    this.cursorFallback = cursorFallback;
    this.requestDraw();
  }
  setMinimumContrastRatio(value: number): void {
    if (this.disposed) return;
    const ratio = normalizeMinimumContrast(value);
    if ((this.minimumContrast?.ratio ?? 1) === ratio) return;
    this.minimumContrast = ratio > 1 ? new NativeContrast(ratio) : undefined;
    for (const pane of this.panes) {
      if (pane.rect.width > 0 && pane.rect.height > 0)
        pane.callbacks.onNeedFullFrame();
      else pane.needsVisibleFull = true;
    }
    this.requestDraw();
  }

  setFont(font: RendererFont): void {
    if (
      this.disposed ||
      (font.family === this.font.family &&
        font.weight === this.font.weight &&
        font.size === this.font.size &&
        font.letterSpacing === this.font.letterSpacing)
    )
      return;
    this.font = font;
    this.metrics = measureCell(this.atlasFont());
    this.refreshAppearance();
    this.options.onMetricsChange?.();
  }
  private readonly lookup = (
    value: number | string,
    face: number,
    wide: boolean,
  ): number => {
    const text =
      typeof value === "string" ? value : String.fromCodePoint(value);
    const key = `${face}:${Number(wide)}:${text}`;
    const known = this.keys.get(key);
    if (known !== undefined) return known;
    const bytes = key.length * 2;
    if (this.glyphs.length >= MAX_KEYS || this.keyBytes + bytes > MAX_KEY_BYTES)
      throw new RenderCapacityError();
    const id = this.glyphs.push({ text, face });
    this.keys.set(key, id);
    this.keyBytes += bytes;
    return id;
  };
  applyFrame(pane: RenderPane, frame: DecodedFrame): ApplyResult {
    if (this.disposed) return "applied";
    if (pane.rect.width <= 0 || pane.rect.height <= 0) {
      pane.grid = null;
      pane.header = null;
      pane.needsVisibleFull = true;
      return "needs-full";
    }
    if (this.blocked.has(pane)) return "blocked";
    try {
      const result = applyFrame(
        pane.grid,
        frame,
        this.lookup,
        this.minimumContrast,
      );
      if (result.result === "needs-full") return result.result;
      if (frame.graphics?.placements.length)
        this.graphics ??= new CanvasGraphics();
      this.graphics?.apply(pane, frame.graphics);
      pane.grid = result.grid;
    } catch (error) {
      this.graphics?.remove(pane);
      pane.grid = null;
      pane.header = null;
      pane.undrawn = true;
      if (!(error instanceof RenderCapacityError)) throw error;
      if (!this.retried.has(pane)) {
        this.retried.add(pane);
        this.pending = new Set(
          this.panes.filter(
            (item) => item.rect.width > 0 && item.rect.height > 0,
          ),
        );
        this.resetGlyphs();
        this.refresh();
        return "needs-full";
      }
      this.blocked.add(pane);
      this.updateBlink();
      this.requestDraw();
      throw error;
    }
    pane.header = {
      cursorX: frame.cursorX,
      cursorY: frame.cursorY,
      cursorStyle: frame.cursorStyle,
      cursorColor: frame.cursorColor,
      blink: (frame.flags & FRAME_FLAG_CURSOR_BLINK) !== 0,
      scrolledBack: (frame.flags & FRAME_FLAG_SCROLLED_BACK) !== 0,
      defaultFg: frame.defaultFg,
      defaultBg: frame.defaultBg,
    };
    pane.undrawn = true;
    if (frame.full) this.pending.delete(pane);
    this.completeRecovery();
    this.updateBlink();
    this.requestDraw();
    return "applied";
  }
  markUndrawn(pane: RenderPane): void {
    pane.undrawn = true;
    this.requestDraw();
  }
  requestDraw(): void {
    if (!this.disposed && !this.rafId)
      this.rafId = requestAnimationFrame(this.frame);
  }
  private readonly frame = (): void => {
    this.rafId = 0;
    if (this.disposed) return;
    const start = performance.now();
    let drawn: Map<RenderPane, boolean>;
    try {
      drawn = this.draw();
    } catch {
      drawn = new Map();
      for (const pane of this.panes)
        if (pane.rect.width > 0 && pane.rect.height > 0) {
          this.failPaint(pane);
          drawn.set(pane, false);
        }
    }
    const at = performance.now();
    this.stats.draws++;
    this.stats.lastDrawMs = at - start;
    this.options.onDrawTiming?.(
      at,
      at - start,
      [...drawn.values()].filter(Boolean).length,
    );
    for (const [pane, rendered] of drawn)
      if (pane.undrawn) {
        pane.undrawn = false;
        try {
          pane.callbacks.onDrawn(rendered);
        } catch {}
      }
  };
  private draw(): Map<RenderPane, boolean> {
    const c = this.context,
      m = this.metrics,
      drawn = new Map<RenderPane, boolean>();
    c.fillStyle = css(this.background);
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const pane of this.panes) {
      const x = Math.round(pane.rect.x * this.dpr),
        y = Math.round(pane.rect.y * this.dpr),
        w = Math.round(pane.rect.width * this.dpr),
        h = Math.round(pane.rect.height * this.dpr);
      if (
        w <= 0 ||
        h <= 0 ||
        x >= this.canvas.width ||
        y >= this.canvas.height ||
        x + w <= 0 ||
        y + h <= 0
      )
        continue;
      c.save();
      try {
        c.beginPath();
        c.rect(x, y, w, h);
        c.clip();
        c.translate(x, y);
        c.fillStyle = css(pane.header?.defaultBg ?? this.background);
        c.fillRect(0, 0, w, h);
        drawn.set(pane, false);
        if (pane.grid && pane.header) {
          this.graphics?.draw(c, pane, 0, m.width, m.height);
          this.cells(pane, true);
          this.graphics?.draw(c, pane, 1, m.width, m.height);
          this.cells(pane, false);
          this.graphics?.draw(c, pane, 2, m.width, m.height);
          drawn.set(pane, true);
        }
      } catch {
        this.failPaint(pane);
        drawn.set(pane, false);
      } finally {
        c.restore();
      }
    }
    return drawn;
  }
  private failPaint(pane: RenderPane): void {
    this.graphics?.remove(pane);
    pane.grid = null;
    pane.header = null;
    pane.undrawn = true;
    this.blocked.add(pane);
    this.updateBlink();
    try {
      pane.callbacks.onError?.(new RenderCapacityError());
    } catch {}
  }
  private refreshAppearance(): void {
    const clear =
      this.blocked.size > 0 || this.retried.size > 0 || this.pending.size > 0;
    if (clear) {
      this.blocked.clear();
      this.retried.clear();
      this.pending.clear();
      this.resetGlyphs();
    }
    this.refresh(clear);
  }
  private cells(pane: RenderPane, background: boolean): void {
    const g = pane.grid,
      h = pane.header;
    if (!g || !h) return;
    const c = this.context,
      m = this.metrics;
    let style = h.cursorStyle;
    if (style === CURSOR_BLOCK && !pane.focused) style = CURSOR_HOLLOW_BLOCK;
    const visible =
      style !== CURSOR_HIDDEN &&
      !h.scrolledBack &&
      (!h.blink || this.blinkOn) &&
      h.cursorX < g.cols &&
      h.cursorY < g.rows;
    const cursor = visible ? h.cursorY * g.cols + h.cursorX : -1;
    const cursorColor =
      h.cursorColor === CURSOR_COLOR_NONE
        ? (this.cursorFallback ?? h.defaultFg)
        : h.cursorColor;
    const hasImages = this.graphics?.has(pane) ?? false;
    for (let i = 0; i < g.cols * g.rows; i++) {
      const word = i * CELL_WORDS,
        bits = g.cells[word],
        isCursor = i === cursor;
      if (bits & GLYPH_SKIP && !isCursor) continue;
      const x = (i % g.cols) * m.width,
        y = Math.floor(i / g.cols) * m.height,
        span = bits & GLYPH_WIDE ? 2 : 1,
        w = span * m.width;
      const bg = g.cells[word + 2],
        block = isCursor && style === CURSOR_BLOCK;
      if (background) {
        if (!hasImages || bg !== h.defaultBg || block) {
          c.fillStyle = css(block ? cursorColor : bg);
          c.fillRect(x, y, w, m.height);
        }
        continue;
      }
      c.save();
      try {
        c.beginPath();
        c.rect(x, y, w, m.height);
        c.clip();
        const fg = block ? bg : g.cells[word + 1];
        if (block) {
          c.fillStyle = css(cursorColor);
          c.fillRect(x, y, w, m.height);
        }
        const glyph = this.glyphs[(bits & GLYPH_SLOT_MASK) - 1];
        if (glyph) {
          c.font = fontString(this.atlasFont(), glyph.face);
          c.textBaseline = "alphabetic";
          c.fillStyle = css(fg);
          c.fillText(glyph.text, x, y + m.baseline);
        }
        this.decorations(bits, x, y, w, fg, g.cells[word + 3]);
        if (isCursor && style !== CURSOR_BLOCK) {
          c.fillStyle = css(cursorColor);
          const b = Math.max(1, Math.round(this.dpr * 1.5));
          if (style === CURSOR_BAR) c.fillRect(x, y, b, m.height);
          else if (style === CURSOR_UNDERLINE)
            c.fillRect(
              x,
              y +
                m.height -
                Math.max(b, Math.max(1, Math.round(m.height / 16)) * 2),
              w,
              Math.max(b, Math.max(1, Math.round(m.height / 16)) * 2),
            );
          else if (style === CURSOR_HOLLOW_BLOCK) {
            c.fillRect(x, y, w, b);
            c.fillRect(x, y + m.height - b, w, b);
            c.fillRect(x, y, b, m.height);
            c.fillRect(x + w - b, y, b, m.height);
          }
        }
      } finally {
        c.restore();
      }
    }
  }
  private decorations(
    bits: number,
    x: number,
    y: number,
    w: number,
    fg: number,
    ul: number,
  ): void {
    const c = this.context,
      m = this.metrics,
      t = Math.max(1, Math.round(m.height / 16)),
      top = Math.min(m.baseline + t, m.height - t),
      kind = (bits >>> 27) & 7;
    if (kind) {
      c.fillStyle = css(ul);
      for (let dx = 0; dx < w; dx++)
        for (
          let dy = Math.max(0, top - 2 * t);
          dy < Math.min(m.height, top + 3 * t);
          dy++
        ) {
          const line = dy >= top && dy < top + t;
          const hit =
            kind === 1
              ? line
              : kind === 2
                ? (dy >= top - t && dy < top) ||
                  (dy >= top + t && dy < top + 2 * t)
                : kind === 3
                  ? Math.abs(
                      dy -
                        (top +
                          t * 0.5 +
                          t * Math.sin(((x + dx) * Math.PI * 2) / m.width)),
                    ) <
                    t * 0.6 + 0.25
                  : kind === 4
                    ? line && Math.floor((x + dx) / Math.max(t, 2)) % 2 === 0
                    : kind === 5
                      ? line && (x + dx) % m.width < m.width * 0.6
                      : false;
          if (hit) c.fillRect(x + dx, y + dy, 1, 1);
        }
    }
    c.fillStyle = css(fg);
    if (bits & 0x40000000)
      c.fillRect(x, y + Math.round(m.baseline - m.baseline * 0.32), w, t);
    if (bits & 0x80000000) c.fillRect(x, y, w, t);
  }
  snapshot(pane?: RenderPane): string | null {
    if (
      this.disposed ||
      (pane &&
        (!this.panes.includes(pane) ||
          pane.rect.width <= 0 ||
          pane.rect.height <= 0))
    )
      return null;
    this.draw();
    if (!pane) return this.canvas.toDataURL("image/png");
    const image = document.createElement("canvas");
    image.width = Math.max(1, Math.round(pane.rect.width * this.dpr));
    image.height = Math.max(1, Math.round(pane.rect.height * this.dpr));
    const context = image.getContext("2d");
    if (!context) return null;
    context.drawImage(
      this.canvas,
      Math.round(pane.rect.x * this.dpr),
      Math.round(pane.rect.y * this.dpr),
      image.width,
      image.height,
      0,
      0,
      image.width,
      image.height,
    );
    return image.toDataURL("image/png");
  }
  retryCapacity(): void {
    if (!this.retried.size && !this.blocked.size) return;
    this.retried.clear();
    this.blocked.clear();
    this.pending.clear();
    this.resetGlyphs();
    this.refresh();
  }
  private completeRecovery(): void {
    if (!this.pending.size && !this.blocked.size) this.retried.clear();
  }
  private resetGlyphs(): void {
    this.glyphs = [];
    this.keys.clear();
    this.keyBytes = 0;
    this.stats.atlasResets++;
  }
  private refresh(clear = true): void {
    for (const pane of this.panes) {
      if (clear && pane.grid) clearGlyphs(pane.grid);
      if (pane.rect.width > 0 && pane.rect.height > 0)
        pane.callbacks.onNeedFullFrame();
      else pane.needsVisibleFull = true;
    }
    this.requestDraw();
  }
  private updateBlink(): void {
    const any = this.panes.some((p) => p.header?.blink);
    if (any && !this.blinkTimer)
      this.blinkTimer = setInterval(() => {
        this.blinkOn = !this.blinkOn;
        this.requestDraw();
      }, 500);
    else if (!any && this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
      this.blinkOn = true;
    }
  }
  private atlasFont(): AtlasFont {
    return {
      family: this.font.family,
      weight: this.font.weight,
      sizePx: Math.max(1, Math.round(this.font.size * this.dpr)),
      letterSpacingPx: this.font.letterSpacing * this.dpr,
    };
  }
  private watchDpr(): void {
    this.dprQuery?.removeEventListener("change", this.dprChanged);
    this.dprQuery = window.matchMedia(`(resolution: ${this.dpr}dppx)`);
    this.dprQuery.addEventListener("change", this.dprChanged);
  }
  private readonly dprChanged = (): void => {
    if (this.disposed) return;
    const next = window.devicePixelRatio || 1;
    if (next === this.dpr) {
      this.watchDpr();
      return;
    }
    const width = this.canvas.width / this.dpr,
      height = this.canvas.height / this.dpr;
    this.dpr = next;
    this.metrics = measureCell(this.atlasFont());
    this.watchDpr();
    this.resize(width, height);
    this.refreshAppearance();
    this.options.onMetricsChange?.();
  };
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.minimumContrast = undefined;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    this.dprQuery?.removeEventListener("change", this.dprChanged);
    this.graphics?.dispose();
    for (const pane of this.panes) {
      pane.grid = null;
      pane.header = null;
    }
    this.panes = [];
    this.keys.clear();
    this.glyphs = [];
    this.keyBytes = 0;
    this.canvas.width = this.canvas.height = 0;
  }
}
