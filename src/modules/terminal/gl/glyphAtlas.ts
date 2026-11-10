import {
  FONT_BOLD,
  FONT_ITALIC,
  GLYPH_COLOR,
} from "@/modules/terminal/gl/cellBuffer";

/** Font as the atlas rasterizes it; sizes are device pixels. */
export type AtlasFont = {
  family: string;
  weight: string;
  sizePx: number;
  letterSpacingPx: number;
};

export type CellMetrics = {
  /** Device pixels. */
  width: number;
  height: number;
  baseline: number;
};

const ATLAS_PAGE_PX = 1024;
const MAX_MONO_PAGES = 16;
const MAX_COLOR_PAGES = 4;
const CHROMA_THRESHOLD = 24;

/**
 * Hands out cell-sized slots on fixed-size pages, row-major. A wide glyph
 * takes two adjacent slots and never straddles a page row. Pure bookkeeping,
 * so the growth and exhaustion rules are testable without a canvas.
 */
export class SlotAllocator {
  readonly columns: number;
  readonly rowsPerPage: number;
  readonly slotsPerPage: number;
  pages = 0;
  private next = 0;

  constructor(
    pagePx: number,
    cell: CellMetrics,
    private readonly maxPages: number,
  ) {
    this.columns = Math.floor(pagePx / cell.width);
    this.rowsPerPage = Math.floor(pagePx / cell.height);
    this.slotsPerPage = this.columns * this.rowsPerPage;
  }

  /**
   * Global slot index, or -1 when every page this allocator may open is full.
   * Slot 0 is never handed out: an instance with slot 0 draws no glyph.
   */
  allocate(span: 1 | 2): number {
    if (this.columns < 2 || this.rowsPerPage < 1 || this.maxPages < 1) {
      return -1;
    }
    let local = this.next;
    if (this.pages === 0) {
      this.pages = 1;
      local = 1;
    }
    if ((local % this.columns) + span > this.columns) {
      local += this.columns - (local % this.columns);
    }
    if (local + span > this.slotsPerPage) {
      if (this.pages >= this.maxPages) return -1;
      this.pages += 1;
      local = 0;
    }
    this.next = local + span;
    return (this.pages - 1) * this.slotsPerPage + local;
  }

  reset(): void {
    this.pages = 0;
    this.next = 0;
  }
}

/** True when a rasterized glyph carries its own colour (an emoji). */
export function isColorGlyph(rgba: Uint8ClampedArray): boolean {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 16) continue;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const hi = r > g ? (r > b ? r : b) : g > b ? g : b;
    const lo = r < g ? (r < b ? r : b) : g < b ? g : b;
    if (hi - lo > CHROMA_THRESHOLD) return true;
  }
  return false;
}

export function fontString(font: AtlasFont, face: number): string {
  const style = face & FONT_ITALIC ? "italic " : "";
  const weight = face & FONT_BOLD ? "bold" : font.weight || "normal";
  return `${style}${weight} ${font.sizePx}px ${font.family}`;
}

function measureCell(font: AtlasFont): CellMetrics {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.font = fontString(font, 0);
  const m = ctx.measureText("M");
  const ascent = m.fontBoundingBoxAscent || font.sizePx * 0.8;
  const descent = m.fontBoundingBoxDescent || font.sizePx * 0.2;
  return {
    width: Math.max(1, Math.round(m.width + font.letterSpacingPx)),
    height: Math.max(1, Math.ceil(ascent + descent)),
    baseline: Math.ceil(ascent),
  };
}

type Page = { data: Uint8Array; dirtyTop: number; dirtyBottom: number };

class PageSet {
  readonly allocator: SlotAllocator;
  readonly pages: Page[] = [];
  texture: WebGLTexture | null = null;
  layers = 0;

  constructor(
    readonly bytesPerPixel: 1 | 4,
    cell: CellMetrics,
    maxPages: number,
  ) {
    this.allocator = new SlotAllocator(ATLAS_PAGE_PX, cell, maxPages);
  }

  page(index: number): Page {
    while (this.pages.length <= index) {
      this.pages.push({
        data: new Uint8Array(
          ATLAS_PAGE_PX * ATLAS_PAGE_PX * this.bytesPerPixel,
        ),
        dirtyTop: ATLAS_PAGE_PX,
        dirtyBottom: 0,
      });
    }
    return this.pages[index];
  }

  clear(): void {
    this.allocator.reset();
    this.pages.length = 0;
  }
}

/**
 * One atlas per GL context. Coverage glyphs go to R8 pages tinted by the cell
 * foreground; glyphs that rasterize in colour go to RGBA pages and keep their
 * colours. The CPU copy of every page is retained so a lost context can be
 * rebuilt without the panes' codepoints, which the webview does not keep.
 */
export class GlyphAtlas {
  metrics: CellMetrics;
  /** Set when a glyph found no room; the owner resets and asks for full frames. */
  exhausted = false;
  private font: AtlasFont;
  private mono: PageSet;
  private color: PageSet;
  private slots = new Map<number, number>();
  private scratch: CanvasRenderingContext2D;
  private placeholder: WebGLTexture | null = null;

  constructor(font: AtlasFont) {
    this.font = font;
    this.metrics = measureCell(font);
    this.mono = new PageSet(1, this.metrics, MAX_MONO_PAGES);
    this.color = new PageSet(4, this.metrics, MAX_COLOR_PAGES);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.scratch = ctx;
    this.sizeScratch();
  }

  get columns(): number {
    return this.mono.allocator.columns;
  }

  get slotsPerPage(): number {
    return this.mono.allocator.slotsPerPage;
  }

  get glyphCount(): number {
    return this.slots.size;
  }

  setFont(font: AtlasFont): void {
    this.font = font;
    this.metrics = measureCell(font);
    this.mono = new PageSet(1, this.metrics, MAX_MONO_PAGES);
    this.color = new PageSet(4, this.metrics, MAX_COLOR_PAGES);
    this.slots.clear();
    this.exhausted = false;
    this.sizeScratch();
  }

  /** Forgets every glyph; textures keep their storage and are rewritten. */
  reset(): void {
    this.mono.clear();
    this.color.clear();
    this.slots.clear();
    this.exhausted = false;
  }

  readonly lookup = (
    codepoint: number,
    face: number,
    wide: boolean,
  ): number => {
    const key = codepoint + face * 0x200000 + (wide ? 0x800000 : 0);
    const known = this.slots.get(key);
    if (known !== undefined) return known;
    if (this.exhausted) return 0;
    const bits = this.rasterize(codepoint, face, wide);
    if (bits < 0) {
      this.exhausted = true;
      return 0;
    }
    this.slots.set(key, bits);
    return bits;
  };

  private sizeScratch(): void {
    const canvas = this.scratch.canvas;
    canvas.width = this.metrics.width * 2;
    canvas.height = this.metrics.height;
  }

  private rasterize(codepoint: number, face: number, wide: boolean): number {
    const span = wide ? 2 : 1;
    const { width, height, baseline } = this.metrics;
    const w = width * span;
    const ctx = this.scratch;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, height);
    ctx.clip();
    ctx.font = fontString(this.font, face);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fff";
    ctx.fillText(String.fromCodePoint(codepoint), 0, baseline);
    ctx.restore();
    const rgba = ctx.getImageData(0, 0, w, height).data;
    const colored = isColorGlyph(rgba);
    const set = colored ? this.color : this.mono;
    const slot = set.allocator.allocate(span);
    if (slot < 0) return -1;
    const perPage = set.allocator.slotsPerPage;
    const pageIndex = Math.floor(slot / perPage);
    const local = slot % perPage;
    const x0 = (local % set.allocator.columns) * width;
    const y0 = Math.floor(local / set.allocator.columns) * height;
    const page = set.page(pageIndex);
    const data = page.data;
    for (let y = 0; y < height; y++) {
      const src = y * w * 4;
      if (colored) {
        data.set(
          rgba.subarray(src, src + w * 4),
          ((y0 + y) * ATLAS_PAGE_PX + x0) * 4,
        );
      } else {
        let dst = (y0 + y) * ATLAS_PAGE_PX + x0;
        for (let x = 0; x < w; x++) data[dst++] = rgba[src + x * 4 + 3];
      }
    }
    if (y0 < page.dirtyTop) page.dirtyTop = y0;
    if (y0 + height > page.dirtyBottom) page.dirtyBottom = y0 + height;
    return colored ? slot | GLYPH_COLOR : slot;
  }

  /** Binds both page arrays to units 0 and 1, uploading what changed. */
  bind(gl: WebGL2RenderingContext): void {
    this.syncSet(gl, this.mono, gl.R8, gl.RED, 0);
    this.syncSet(gl, this.color, gl.RGBA8, gl.RGBA, 1);
  }

  private syncSet(
    gl: WebGL2RenderingContext,
    set: PageSet,
    internal: number,
    format: number,
    unit: number,
  ): void {
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (set.pages.length === 0) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.placeholderTexture(gl));
      return;
    }
    if (!set.texture) set.texture = createArrayTexture(gl);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, set.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (set.layers !== set.pages.length) {
      gl.texImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        internal,
        ATLAS_PAGE_PX,
        ATLAS_PAGE_PX,
        set.pages.length,
        0,
        format,
        gl.UNSIGNED_BYTE,
        null,
      );
      set.layers = set.pages.length;
      for (const page of set.pages) {
        page.dirtyTop = 0;
        page.dirtyBottom = ATLAS_PAGE_PX;
      }
    }
    for (let layer = 0; layer < set.pages.length; layer++) {
      const page = set.pages[layer];
      if (page.dirtyBottom <= page.dirtyTop) continue;
      const rowBytes = ATLAS_PAGE_PX * set.bytesPerPixel;
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        page.dirtyTop,
        layer,
        ATLAS_PAGE_PX,
        page.dirtyBottom - page.dirtyTop,
        1,
        format,
        gl.UNSIGNED_BYTE,
        page.data,
        page.dirtyTop * rowBytes,
      );
      page.dirtyTop = ATLAS_PAGE_PX;
      page.dirtyBottom = 0;
    }
  }

  private placeholderTexture(gl: WebGL2RenderingContext): WebGLTexture {
    if (this.placeholder) return this.placeholder;
    const texture = createArrayTexture(gl);
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA8,
      1,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(4),
    );
    this.placeholder = texture;
    return texture;
  }

  /** Forgets GL handles after a context loss; the CPU pages stay. */
  dropContext(): void {
    for (const set of [this.mono, this.color]) {
      set.texture = null;
      set.layers = 0;
    }
    this.placeholder = null;
  }

  disposeTextures(gl: WebGL2RenderingContext): void {
    for (const set of [this.mono, this.color]) {
      if (set.texture) gl.deleteTexture(set.texture);
    }
    if (this.placeholder) gl.deleteTexture(this.placeholder);
    this.dropContext();
  }

  /** Releases CPU pages too; the atlas is unusable afterwards. */
  release(): void {
    this.mono.clear();
    this.color.clear();
    this.slots.clear();
  }

  get textureBytes(): number {
    return (
      this.mono.layers * ATLAS_PAGE_PX * ATLAS_PAGE_PX +
      this.color.layers * ATLAS_PAGE_PX * ATLAS_PAGE_PX * 4
    );
  }
}

function createArrayTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("texture allocation failed");
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}
