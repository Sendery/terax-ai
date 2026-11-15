import {
  NativeContrast,
  normalizeMinimumContrast,
} from "@/modules/terminal/gl/minimumContrast";
import { GraphicsRenderer } from "@/modules/terminal/gl/graphicsRenderer";
import { RenderCapacityError } from "@/modules/terminal/gl/renderCapacity";
import {
  type ApplyResult,
  applyFrame,
  CELL_WORDS,
  type CellGrid,
  clearGlyphs,
} from "@/modules/terminal/gl/cellBuffer";
import {
  CURSOR_BLOCK,
  CURSOR_COLOR_NONE,
  CURSOR_HIDDEN,
  CURSOR_HOLLOW_BLOCK,
  createRowView,
  type DecodedFrame,
  FRAME_FLAG_CURSOR_BLINK,
  FRAME_FLAG_SCROLLED_BACK,
  readRow,
} from "@/modules/terminal/gl/frameCodec";
import {
  type AtlasFont,
  type CellMetrics,
  GlyphAtlas,
} from "@/modules/terminal/gl/glyphAtlas";

/** Sizes in CSS pixels. */
export type RendererFont = {
  family: string;
  weight: string;
  size: number;
  letterSpacing: number;
};

export type PaneRect = { x: number; y: number; width: number; height: number };

export type PaneCallbacks = {
  /** The pane's glyphs or GPU state were rebuilt; its next frame must be full. */
  onNeedFullFrame: () => void;
  /** A display frame showing everything applied so far has been drawn. */
  onDrawn: (rendered?: boolean) => void;
  onError?: (error: unknown) => void;
};

export type GridRendererOptions = {
  font: RendererFont;
  /** 0x00BBGGRR, the canvas outside every pane. */
  background: number;
  minimumContrastRatio?: number;
  /** 0x00BBGGRR, the cursor when the terminal sets no colour. */
  cursorFallback?: number;
  /** Fired after the cell size changed (font or device pixel ratio). */
  onMetricsChange?: () => void;
  onDrawTiming?: (
    at: number,
    submissionMs: number,
    renderedPanes: number,
  ) => void;
};

type PaneHeader = {
  cursorX: number;
  cursorY: number;
  cursorStyle: number;
  cursorColor: number;
  blink: boolean;
  scrolledBack: boolean;
  defaultFg: number;
  defaultBg: number;
};

export type RenderPane = {
  needsVisibleFull?: boolean;
  readonly callbacks: PaneCallbacks;
  rect: PaneRect;
  grid: CellGrid | null;
  header: PaneHeader | null;
  focused: boolean;
  vao: WebGLVertexArrayObject | null;
  vbo: WebGLBuffer | null;
  gpuCells: number;
  undrawn: boolean;
};

const VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in uvec4 aCell;
uniform ivec2 uGrid;
uniform vec2 uCellPx;
uniform vec2 uViewPx;
uniform int uAtlasCols;
uniform int uSlotsPerPage;
uniform int uCursorIndex;
out vec2 vLocal;
out float vAbsX;
flat out vec3 vFg;
flat out vec3 vBg;
flat out uint vBgRgb;
flat out vec3 vUl;
flat out ivec3 vAtlas;
flat out uint vBits;
flat out float vSpanW;
vec3 rgb(uint c) {
  return vec3(float(c & 255u), float((c >> 8) & 255u), float((c >> 16) & 255u)) / 255.0;
}
void main() {
  uint bits = aCell.x;
  bool cursor = gl_InstanceID == uCursorIndex;
  if ((bits & 0x2000000u) != 0u) {
    if (!cursor) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    bits &= 0xF8000000u;
  }
  bool wide = (bits & 0x1000000u) != 0u;
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 cell = vec2(float(gl_InstanceID % uGrid.x), float(gl_InstanceID / uGrid.x));
  vec2 size = vec2(wide ? 2.0 : 1.0, 1.0) * uCellPx;
  vec2 px = cell * uCellPx + corner * size;
  vec2 clip = px / uViewPx * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = corner * size;
  vAbsX = px.x;
  int slot = int(bits & 0xFFFFFFu);
  int page = slot / uSlotsPerPage;
  int local = slot - page * uSlotsPerPage;
  vAtlas = ivec3(
    (local % uAtlasCols) * int(uCellPx.x),
    (local / uAtlasCols) * int(uCellPx.y),
    page
  );
  vFg = rgb(aCell.y);
  vBg = rgb(aCell.z);
  vBgRgb = aCell.z & 0xffffffu;
  vUl = rgb(aCell.w);
  vBits = cursor ? (bits | 0x2000000u) : bits;
  vSpanW = size.x;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray uMono;
uniform sampler2DArray uColor;
uniform vec2 uCellPx;
uniform vec4 uLines;
uniform int uCursorStyle;
uniform vec3 uCursorColor;
uniform int uPass;
uniform uint uDefaultBg;
in vec2 vLocal;
in float vAbsX;
flat in vec3 vFg;
flat in vec3 vBg;
flat in uint vBgRgb;
flat in vec3 vUl;
flat in ivec3 vAtlas;
flat in uint vBits;
flat in float vSpanW;
out vec4 outColor;
bool underlineHit(uint kind, float x, float y) {
  float top = uLines.x;
  float t = uLines.y;
  bool line = y >= top && y < top + t;
  if (kind == 1u) return line;
  if (kind == 2u) return (y >= top - t && y < top) || (y >= top + t && y < top + 2.0 * t);
  if (kind == 3u) {
    float wave = top + t * 0.5 + t * sin(x * 6.2831853 / uCellPx.x);
    return abs(y - wave) < t * 0.6 + 0.25;
  }
  if (kind == 4u) return line && mod(floor(x / max(t, 2.0)), 2.0) < 1.0;
  if (kind == 5u) return line && mod(x, uCellPx.x) < uCellPx.x * 0.6;
  return false;
}
void main() {
  bool cursor = (vBits & 0x2000000u) != 0u;
  vec3 fg = vFg;
  vec3 bg = vBg;
  if (cursor && uCursorStyle == 1) {
    fg = vBg;
    bg = uCursorColor;
  }
  if (uPass == 1) {
    if (vBgRgb == uDefaultBg && !(cursor && uCursorStyle == 1)) discard;
    outColor = vec4(bg,1.0);
    return;
  }
  bool opaque = uPass == 0 || (cursor && uCursorStyle == 1);
  float opacity = opaque ? 1.0 : 0.0;
  vec3 color = bg;
  if ((vBits & 0xFFFFFFu) != 0u) {
    ivec3 texel = ivec3(vAtlas.xy + ivec2(vLocal), vAtlas.z);
    if ((vBits & 0x4000000u) != 0u) {
      vec4 c = texelFetch(uColor, texel, 0);
      color = opaque ? mix(color,c.rgb,c.a) : c.rgb;
      opacity = opaque ? 1.0 : c.a;
    } else {
      float coverage = texelFetch(uMono, texel, 0).r;
      color = opaque ? mix(color,fg,coverage) : fg;
      opacity = opaque ? 1.0 : coverage;
    }
  }
  float x = vLocal.x;
  float y = vLocal.y;
  uint kind = (vBits >> 27) & 7u;
  if (kind != 0u && underlineHit(kind, vAbsX, y)) { color = vUl; opacity = 1.0; }
  if ((vBits & 0x40000000u) != 0u && y >= uLines.z && y < uLines.z + uLines.y) { color = fg; opacity = 1.0; }
  if ((vBits & 0x80000000u) != 0u && y < uLines.y) { color = fg; opacity = 1.0; }
  if (cursor) {
    float b = uLines.w;
    bool hit = false;
    if (uCursorStyle == 2) hit = x < b;
    else if (uCursorStyle == 3) hit = y >= uCellPx.y - max(b, uLines.y * 2.0);
    else if (uCursorStyle == 4) hit = x < b || x >= vSpanW - b || y < b || y >= uCellPx.y - b;
    if (hit) { color = uCursorColor; opacity = 1.0; }
  }
  outColor = vec4(color,opacity);
}`;

const UNIFORMS = [
  "uGrid",
  "uCellPx",
  "uViewPx",
  "uAtlasCols",
  "uSlotsPerPage",
  "uCursorIndex",
  "uMono",
  "uColor",
  "uLines",
  "uCursorStyle",
  "uCursorColor",
  "uPass",
  "uDefaultBg",
] as const;

type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

const BLINK_MS = 600;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("shader allocation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function channel(color: number, shift: number): number {
  return ((color >>> shift) & 0xff) / 255;
}

/**
 * Draws any number of terminal panes on one canvas through one WebGL2
 * context and one glyph atlas: one instanced draw per pane. Owns no
 * terminal state beyond each pane's instance buffer and last header.
 */
export type TerminalRenderer = Pick<GridRenderer, keyof GridRenderer>;

export class GridRenderer {
  readonly backend: "webgl" | "canvas" = "webgl";
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private uniforms: Uniforms | null = null;
  private atlas: GlyphAtlas;
  private graphics?: GraphicsRenderer;
  private font: RendererFont;
  private dpr: number;
  private background: number;
  private minimumContrast?: NativeContrast;
  private cursorFallback: number | undefined;
  private onMetricsChange: (() => void) | undefined;
  private readonly onDrawTiming: GridRendererOptions["onDrawTiming"];
  private panes: RenderPane[] = [];
  private readonly drawnPanes = new Map<RenderPane, boolean>();
  private lost = false;
  private disposed = false;
  private rafId = 0;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private blinkOn = true;
  private dprQuery: MediaQueryList | null = null;
  private readonly rowScratch = createRowView();
  private capacityRetried?: Set<RenderPane>;
  private capacityBlocked?: Set<RenderPane>;
  private capacityPending?: Set<RenderPane>;
  readonly stats = {
    draws: 0,
    lastDrawMs: 0,
    contextLosses: 0,
    atlasResets: 0,
  };

  constructor(canvas: HTMLCanvasElement, options: GridRendererOptions) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      desynchronized: true,
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.canvas = canvas;
    this.gl = gl;
    this.font = options.font;
    this.background = options.background;
    const contrast = normalizeMinimumContrast(options.minimumContrastRatio);
    this.minimumContrast =
      contrast > 1 ? new NativeContrast(contrast) : undefined;
    this.cursorFallback = options.cursorFallback;
    this.onMetricsChange = options.onMetricsChange;
    this.onDrawTiming = options.onDrawTiming;
    this.dpr = window.devicePixelRatio || 1;
    let atlas: GlyphAtlas | null = null;
    try {
      atlas = new GlyphAtlas(this.atlasFont());
      this.atlas = atlas;
      this.initGl();
    } catch (error) {
      atlas?.release();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      throw error;
    }
    canvas.addEventListener("webglcontextlost", this.handleLost);
    canvas.addEventListener("webglcontextrestored", this.handleRestored);
    this.watchDevicePixelRatio();
  }

  /** CSS pixels of one cell, for sizing a pane's grid to its box. */
  get cellSize(): { width: number; height: number } {
    const m = this.atlas.metrics;
    return { width: m.width / this.dpr, height: m.height / this.dpr };
  }

  get cellPixels(): { width: number; height: number } {
    return {
      width: this.atlas.metrics.width,
      height: this.atlas.metrics.height,
    };
  }

  get atlasInfo(): { glyphs: number; textureBytes: number } {
    return {
      glyphs: this.atlas.glyphCount,
      textureBytes: this.atlas.textureBytes,
    };
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
    if (!this.lost) this.createPaneBuffers(pane);
    this.panes.push(pane);
    return pane;
  }

  removePane(pane: RenderPane): void {
    const index = this.panes.indexOf(pane);
    if (index < 0) return;
    this.panes.splice(index, 1);
    this.capacityRetried?.delete(pane);
    this.capacityBlocked?.delete(pane);
    this.capacityPending?.delete(pane);
    this.completeCapacityRecovery();
    this.deletePaneBuffers(pane);
    this.graphics?.remove(pane);
    pane.grid = null;
    this.updateBlink();
    this.requestDraw();
  }

  setPaneRect(pane: RenderPane, rect: PaneRect): void {
    const wasVisible = pane.rect.width > 0 && pane.rect.height > 0;
    pane.rect = rect;
    if (rect.width <= 0 || rect.height <= 0) {
      if (this.graphics?.has(pane)) {
        this.graphics.remove(pane);
        pane.grid = null;
        pane.header = null;
        pane.needsVisibleFull = true;
      }
      this.capacityPending?.delete(pane);
      if (wasVisible && this.capacityBlocked?.size) this.retryCapacity();
      this.completeCapacityRecovery();
    } else if (pane.needsVisibleFull) {
      pane.needsVisibleFull = false;
      pane.undrawn = true;
      pane.callbacks.onNeedFullFrame();
    }
    this.requestDraw();
  }

  setPaneFocused(pane: RenderPane, focused: boolean): void {
    if (pane.focused === focused) return;
    pane.focused = focused;
    this.requestDraw();
  }

  /** Backing store size from the canvas's CSS size. */
  resize(cssWidth: number, cssHeight: number): void {
    const width = Math.max(1, Math.round(cssWidth * this.dpr));
    const height = Math.max(1, Math.round(cssHeight * this.dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
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
    const same =
      font.family === this.font.family &&
      font.weight === this.font.weight &&
      font.size === this.font.size &&
      font.letterSpacing === this.font.letterSpacing;
    if (same) return;
    this.font = font;
    this.rebuildAtlas();
  }

  applyFrame(pane: RenderPane, frame: DecodedFrame): ApplyResult {
    if (this.disposed) return "applied";
    if (this.lost) {
      pane.grid = null;
      pane.header = null;
      pane.undrawn = true;
      return "needs-full";
    }
    if (pane.rect.width <= 0 || pane.rect.height <= 0) {
      pane.grid = null;
      pane.header = null;
      pane.needsVisibleFull = true;
      return "needs-full";
    }
    if (this.capacityBlocked?.has(pane)) return "blocked";
    const previous = pane.grid;
    let applied: ReturnType<typeof applyFrame>;
    try {
      applied = applyFrame(
        previous,
        frame,
        this.atlas.lookup,
        this.minimumContrast,
      );
      if (applied.result !== "needs-full") {
        if (frame.graphics?.placements.length)
          this.graphics ??= new GraphicsRenderer(this.gl);
        this.graphics?.apply(pane, frame.graphics);
      }
    } catch (error) {
      this.graphics?.remove(pane);
      if (!(error instanceof RenderCapacityError)) throw error;
      pane.grid = null;
      pane.header = null;
      pane.undrawn = true;
      if (!this.capacityRetried?.has(pane)) {
        this.capacityRetried ??= new Set();
        this.capacityRetried.add(pane);
        this.capacityPending = new Set(
          this.panes.filter(
            (item) => item.rect.width > 0 && item.rect.height > 0,
          ),
        );
        this.atlas.reset();
        this.stats.atlasResets++;
        this.invalidateGlyphs();
        return "needs-full";
      }
      this.capacityBlocked ??= new Set();
      this.capacityBlocked.add(pane);
      this.updateBlink();
      this.requestDraw();
      throw error;
    }
    const { grid, result } = applied;
    if (result === "needs-full") return result;
    pane.grid = grid;
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
    if (!this.lost) this.upload(pane, frame, grid !== previous);
    this.updateBlink();
    if (frame.full) this.capacityPending?.delete(pane);
    this.completeCapacityRecovery();
    this.requestDraw();
    return result;
  }

  /** Reports the pane drawn after the next display frame, frame or not. */
  markUndrawn(pane: RenderPane): void {
    pane.undrawn = true;
    this.requestDraw();
  }

  snapshot(pane?: RenderPane): string | null {
    if (this.disposed || this.lost) return null;
    if (
      pane &&
      (!this.panes.includes(pane) ||
        pane.rect.width <= 0 ||
        pane.rect.height <= 0)
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

  requestDraw(): void {
    if (this.rafId || this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (): void => {
    this.rafId = 0;
    if (this.disposed || this.lost) return;
    const start = performance.now();
    this.draw();
    const at = performance.now();
    this.stats.lastDrawMs = at - start;
    this.stats.draws += 1;
    if (this.onDrawTiming) {
      let renderedPanes = 0;
      for (const rendered of this.drawnPanes.values())
        if (rendered) renderedPanes++;
      this.onDrawTiming(at, this.stats.lastDrawMs, renderedPanes);
    }
    // Hidden frames are discarded, but their credit belongs to this turn.
    for (const pane of this.panes)
      if (pane.undrawn && (pane.rect.width <= 0 || pane.rect.height <= 0))
        this.drawnPanes.set(pane, false);
    for (const [pane, rendered] of this.drawnPanes) {
      if (!pane.undrawn) continue;
      pane.undrawn = false;
      pane.callbacks.onDrawn(rendered);
    }
  };

  private draw(): void {
    this.drawnPanes.clear();
    const gl = this.gl;
    const u = this.uniforms;
    if (!u || !this.program) return;
    const height = this.canvas.height;
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, height);
    gl.clearColor(
      channel(this.background, 0),
      channel(this.background, 8),
      channel(this.background, 16),
      1,
    );
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL call, not a React hook
    gl.useProgram(this.program);
    this.atlas.bind(gl);
    const m: CellMetrics = this.atlas.metrics;
    const thickness = Math.max(1, Math.round(m.height / 16));
    const underlineTop = Math.min(m.baseline + thickness, m.height - thickness);
    const strikeTop = Math.round(m.baseline - m.baseline * 0.32);
    gl.uniform1i(u.uMono, 0);
    gl.uniform1i(u.uColor, 1);
    gl.uniform2f(u.uCellPx, m.width, m.height);
    gl.uniform1i(u.uAtlasCols, this.atlas.columns);
    gl.uniform1i(u.uSlotsPerPage, this.atlas.slotsPerPage);
    gl.uniform4f(
      u.uLines,
      underlineTop,
      thickness,
      strikeTop,
      Math.max(1, Math.round(this.dpr * 1.5)),
    );
    for (const pane of this.panes) {
      const grid = pane.grid;
      const header = pane.header;
      const x = Math.round(pane.rect.x * this.dpr);
      const top = Math.round(pane.rect.y * this.dpr);
      const w = Math.round(pane.rect.width * this.dpr);
      const h = Math.round(pane.rect.height * this.dpr);
      if (
        w <= 0 ||
        h <= 0 ||
        x >= this.canvas.width ||
        top >= height ||
        x + w <= 0 ||
        top + h <= 0
      )
        continue;
      gl.scissor(x, height - top - h, w, h);
      gl.clearColor(
        channel(header?.defaultBg ?? this.background, 0),
        channel(header?.defaultBg ?? this.background, 8),
        channel(header?.defaultBg ?? this.background, 16),
        1,
      );
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawnPanes.set(pane, false);
      if (!grid || !header || !pane.vao) continue;
      const gridW = grid.cols * m.width;
      const gridH = grid.rows * m.height;
      gl.viewport(x, height - top - gridH, gridW, gridH);
      gl.uniform2i(u.uGrid, grid.cols, grid.rows);
      gl.uniform2f(u.uViewPx, gridW, gridH);
      this.setCursorUniforms(u, pane, header, grid);
      const images = this.graphics?.has(pane) ?? false;
      if (images) {
        this.graphics?.draw(pane, 0, m.width, m.height, gridW, gridH);
        // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL call, not a React hook
        gl.useProgram(this.program);
        gl.uniform1ui(u.uDefaultBg, header.defaultBg);
        gl.uniform1i(u.uPass, 1);
        gl.bindVertexArray(pane.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, grid.cols * grid.rows);
        this.graphics?.draw(pane, 1, m.width, m.height, gridW, gridH);
        // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL call, not a React hook
        gl.useProgram(this.program);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(
          gl.SRC_ALPHA,
          gl.ONE_MINUS_SRC_ALPHA,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
        );
      }
      gl.uniform1i(u.uPass, images ? 2 : 0);
      gl.bindVertexArray(pane.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, grid.cols * grid.rows);
      gl.disable(gl.BLEND);
      if (images) this.graphics?.draw(pane, 2, m.width, m.height, gridW, gridH);
      // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL call, not a React hook
      gl.useProgram(this.program);
      this.drawnPanes.set(pane, true);
    }
    gl.bindVertexArray(null);
  }

  private setCursorUniforms(
    u: Uniforms,
    pane: RenderPane,
    header: PaneHeader,
    grid: CellGrid,
  ): void {
    const gl = this.gl;
    let style = header.cursorStyle;
    const visible =
      style !== CURSOR_HIDDEN &&
      !header.scrolledBack &&
      (!header.blink || this.blinkOn) &&
      header.cursorX < grid.cols &&
      header.cursorY < grid.rows;
    if (style === CURSOR_BLOCK && !pane.focused) style = CURSOR_HOLLOW_BLOCK;
    gl.uniform1i(
      u.uCursorIndex,
      visible ? header.cursorY * grid.cols + header.cursorX : -1,
    );
    gl.uniform1i(u.uCursorStyle, visible ? style : 0);
    const color =
      header.cursorColor !== CURSOR_COLOR_NONE
        ? header.cursorColor
        : (this.cursorFallback ?? header.defaultFg);
    gl.uniform3f(
      u.uCursorColor,
      channel(color, 0),
      channel(color, 8),
      channel(color, 16),
    );
  }

  private upload(pane: RenderPane, frame: DecodedFrame, whole: boolean): void {
    const gl = this.gl;
    const grid = pane.grid;
    if (!grid || !pane.vbo) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, pane.vbo);
    if (pane.gpuCells !== grid.cells.length) {
      gl.bufferData(gl.ARRAY_BUFFER, grid.cells, gl.DYNAMIC_DRAW);
      pane.gpuCells = grid.cells.length;
      return;
    }
    if (whole || frame.full) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, grid.cells);
      return;
    }
    const rowWords = grid.cols * CELL_WORDS;
    const row = this.rowScratch;
    let runStart = -1;
    let runEnd = -1;
    for (let i = 0; i < frame.rowCount; i++) {
      const y = readRow(frame, i, row).y;
      if (y === runEnd) {
        runEnd = y + 1;
        continue;
      }
      if (runStart >= 0) this.uploadRows(grid, runStart, runEnd, rowWords);
      runStart = y;
      runEnd = y + 1;
    }
    if (runStart >= 0) this.uploadRows(grid, runStart, runEnd, rowWords);
  }

  private uploadRows(
    grid: CellGrid,
    from: number,
    to: number,
    rowWords: number,
  ): void {
    this.gl.bufferSubData(
      this.gl.ARRAY_BUFFER,
      from * rowWords * 4,
      grid.cells,
      from * rowWords,
      (to - from) * rowWords,
    );
  }

  private uploadWhole(pane: RenderPane): void {
    const grid = pane.grid;
    if (!grid || !pane.vbo) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, pane.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, grid.cells, gl.DYNAMIC_DRAW);
    pane.gpuCells = grid.cells.length;
  }

  private initGl(): void {
    const gl = this.gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("program allocation failed");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`program link failed: ${log}`);
    }
    this.program = program;
    const uniforms = {} as Uniforms;
    for (const name of UNIFORMS) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    this.uniforms = uniforms;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  private createPaneBuffers(pane: RenderPane): void {
    const gl = this.gl;
    pane.vao = gl.createVertexArray();
    pane.vbo = gl.createBuffer();
    pane.gpuCells = 0;
    gl.bindVertexArray(pane.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pane.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_INT, CELL_WORDS * 4, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
  }

  private deletePaneBuffers(pane: RenderPane): void {
    if (!this.lost) {
      if (pane.vao) this.gl.deleteVertexArray(pane.vao);
      if (pane.vbo) this.gl.deleteBuffer(pane.vbo);
    }
    pane.vao = null;
    pane.vbo = null;
    pane.gpuCells = 0;
  }

  private readonly handleLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.stats.contextLosses += 1;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.program = null;
    this.uniforms = null;
    this.atlas.dropContext();
    for (const pane of this.panes)
      if (this.graphics?.has(pane)) {
        pane.grid = null;
        pane.header = null;
      }
    this.graphics?.dropContext();
    for (const pane of this.panes) {
      pane.vao = null;
      pane.vbo = null;
      pane.gpuCells = 0;
    }
  };

  private readonly handleRestored = (): void => {
    if (this.disposed) return;
    this.initGl();
    this.lost = false;
    for (const pane of this.panes) {
      this.createPaneBuffers(pane);
      this.uploadWhole(pane);
      pane.callbacks.onNeedFullFrame();
    }
    this.requestDraw();
  };

  private atlasFont(): AtlasFont {
    return {
      family: this.font.family,
      weight: this.font.weight,
      sizePx: Math.max(1, Math.round(this.font.size * this.dpr)),
      letterSpacingPx: this.font.letterSpacing * this.dpr,
    };
  }

  private completeCapacityRecovery(): void {
    if (this.capacityPending?.size === 0 && !this.capacityBlocked?.size) {
      this.capacityPending = undefined;
      this.capacityRetried?.clear();
    }
  }

  retryCapacity(): void {
    if (!this.capacityRetried?.size && !this.capacityBlocked?.size) return;
    this.capacityRetried?.clear();
    this.capacityBlocked?.clear();
    this.capacityPending = undefined;
    this.atlas.reset();
    this.stats.atlasResets++;
    this.invalidateGlyphs();
  }

  private rebuildAtlas(): void {
    this.capacityRetried?.clear();
    this.capacityBlocked?.clear();
    this.capacityPending = undefined;
    if (!this.lost) this.atlas.disposeTextures(this.gl);
    this.atlas.setFont(this.atlasFont());
    this.invalidateGlyphs();
    this.onMetricsChange?.();
  }

  private invalidateGlyphs(): void {
    for (const pane of this.panes) {
      if (pane.grid) {
        clearGlyphs(pane.grid);
        if (!this.lost) this.uploadWhole(pane);
      }
      if (pane.rect.width > 0 && pane.rect.height > 0) {
        pane.callbacks.onNeedFullFrame();
      } else {
        pane.needsVisibleFull = true;
      }
    }
    this.requestDraw();
  }

  private updateBlink(): void {
    const any = this.panes.some((pane) => pane.header?.blink === true);
    if (any && !this.blinkTimer) {
      this.blinkTimer = setInterval(() => {
        this.blinkOn = !this.blinkOn;
        this.requestDraw();
      }, BLINK_MS);
    } else if (!any && this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
      this.blinkOn = true;
    }
  }

  private watchDevicePixelRatio(): void {
    this.dprQuery?.removeEventListener("change", this.handleDprChange);
    this.dprQuery = window.matchMedia(`(resolution: ${this.dpr}dppx)`);
    this.dprQuery.addEventListener("change", this.handleDprChange);
  }

  private readonly handleDprChange = (): void => {
    if (this.disposed) return;
    const next = window.devicePixelRatio || 1;
    if (next === this.dpr) {
      this.watchDevicePixelRatio();
      return;
    }
    const cssWidth = this.canvas.width / this.dpr;
    const cssHeight = this.canvas.height / this.dpr;
    this.dpr = next;
    this.watchDevicePixelRatio();
    this.resize(cssWidth, cssHeight);
    this.rebuildAtlas();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.minimumContrast = undefined;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    this.dprQuery?.removeEventListener("change", this.handleDprChange);
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.handleRestored,
    );
    for (const pane of this.panes) this.deletePaneBuffers(pane);
    this.panes = [];
    if (!this.lost) {
      this.atlas.disposeTextures(this.gl);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.atlas.release();
    this.graphics?.dispose();
    this.program = null;
    this.uniforms = null;
    // WebKit caps live contexts per page and frees a dropped one only on GC.
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
