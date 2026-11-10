// Cell grid renderer for the libghostty-vt frame format (see src/main.rs).
// One WebGL2 context and one glyph atlas serve every pane on the canvas.

const FLAG_BOLD = 1;
const FLAG_ITALIC = 2;
const FLAG_INVERSE = 8;
const FLAG_WIDE = 64;
const FLAG_HAS_FG = 128;
const BG_HAS = 1 << 24;
const SLOT_WIDE = 1 << 24;
const SLOT_SKIP = 1 << 25;
const HEADER_U32 = 6;
const ATLAS_PX = 2048;

const VS = `#version 300 es
layout(location = 0) in uvec3 aCell;
uniform vec2 uGrid;
uniform vec2 uCellPx;
uniform vec2 uViewPx;
uniform vec2 uAtlasCells;
out vec2 vUv;
flat out vec3 vFg;
flat out vec3 vBg;
flat out float vGlyph;
vec3 rgb(uint c) {
  return vec3(float(c & 255u), float((c >> 8) & 255u), float((c >> 16) & 255u)) / 255.0;
}
void main() {
  uint slot = aCell.x & 0xFFFFFFu;
  bool wide = ((aCell.x >> 24) & 1u) == 1u;
  bool skip = ((aCell.x >> 25) & 1u) == 1u;
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  int cols = int(uGrid.x);
  vec2 cell = vec2(float(gl_InstanceID % cols), float(gl_InstanceID / cols));
  vec2 span = vec2(wide ? 2.0 : 1.0, 1.0);
  vec2 clip = (cell + corner * span) * uCellPx / uViewPx * 2.0 - 1.0;
  gl_Position = skip ? vec4(2.0, 2.0, 0.0, 1.0) : vec4(clip.x, -clip.y, 0.0, 1.0);
  uint atlasCols = uint(uAtlasCells.x);
  vec2 origin = vec2(float(slot % atlasCols), float(slot / atlasCols));
  vUv = (origin + corner * span) / uAtlasCells;
  vFg = rgb(aCell.y);
  vBg = rgb(aCell.z);
  vGlyph = slot == 0u ? 0.0 : 1.0;
}`;

const FS = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
in vec2 vUv;
flat in vec3 vFg;
flat in vec3 vBg;
flat in float vGlyph;
out vec4 outColor;
void main() {
  float a = vGlyph * texture(uAtlas, vUv).r;
  outColor = vec4(mix(vBg, vFg, a), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

class GlyphAtlas {
  constructor(gl, fontFamily, fontPx, cellW, cellH) {
    this.gl = gl;
    this.cellW = cellW;
    this.cellH = cellH;
    this.cols = Math.floor(ATLAS_PX / cellW);
    this.rows = Math.floor(ATLAS_PX / cellH);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.cols * cellW;
    this.canvas.height = this.rows * cellH;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    this.ctx.textBaseline = "alphabetic";
    this.fontFamily = fontFamily;
    this.fontPx = fontPx;
    this.baseline = Math.round(cellH * 0.78);
    this.slots = new Map();
    this.next = 1;
    this.dirty = true;
    this.uploads = 0;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (let cp = 32; cp < 127; cp++) this.slot(cp, 0, false);
  }

  slot(cp, style, wide) {
    const key = cp | (style << 21) | (wide ? 1 << 23 : 0);
    let slot = this.slots.get(key);
    if (slot !== undefined) return slot;
    const span = wide ? 2 : 1;
    if ((this.next % this.cols) + span > this.cols) this.next += span - 1;
    if (this.next + span > this.cols * this.rows) return 0;
    slot = this.next;
    this.next += span;
    const x = (slot % this.cols) * this.cellW;
    const y = Math.floor(slot / this.cols) * this.cellH;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, this.cellW * span, this.cellH);
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.font = `${style & FLAG_ITALIC ? "italic " : ""}${style & FLAG_BOLD ? "bold " : ""}${this.fontPx}px ${this.fontFamily}`;
    ctx.fillText(String.fromCodePoint(cp), x, y + this.baseline);
    ctx.restore();
    this.slots.set(key, slot);
    this.dirty = true;
    return slot;
  }

  sync() {
    if (!this.dirty) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, this.canvas);
    this.dirty = false;
    this.uploads++;
  }
}

export class GridRenderer {
  constructor(canvas, { fontFamily = "Menlo, monospace", fontSize = 13, dpr = 2 } = {}) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, desynchronized: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.canvas = canvas;
    this.dpr = dpr;
    const fontPx = Math.round(fontSize * dpr);
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = `${fontPx}px ${fontFamily}`;
    this.cellW = Math.ceil(probe.measureText("M").width);
    this.cellH = Math.ceil(fontPx * 1.25);
    this.atlas = new GlyphAtlas(gl, fontFamily, fontPx, this.cellW, this.cellH);
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    this.program = program;
    this.uniforms = Object.fromEntries(
      ["uGrid", "uCellPx", "uViewPx", "uAtlasCells", "uAtlas"].map((n) => [n, gl.getUniformLocation(program, n)]),
    );
    this.panes = [];
    gl.enable(gl.SCISSOR_TEST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  addPane(x, y) {
    const gl = this.gl;
    const pane = {
      x: Math.round(x * this.dpr),
      y: Math.round(y * this.dpr),
      cols: 0,
      rows: 0,
      data: new Uint32Array(0),
      vao: gl.createVertexArray(),
      vbo: gl.createBuffer(),
      cursor: null,
      bg: 0,
    };
    gl.bindVertexArray(pane.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, pane.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribIPointer(0, 3, gl.UNSIGNED_INT, 12, 0);
    gl.vertexAttribDivisor(0, 1);
    this.panes.push(pane);
    return pane;
  }

  // `frame` is a Uint32Array over one encoded frame.
  applyFrame(pane, frame) {
    const gl = this.gl;
    const cols = frame[1] & 0xffff;
    const rows = frame[1] >>> 16;
    const cursorX = frame[2] & 0xffff;
    const cursorY = frame[2] >>> 16;
    const visible = frame[3] & 0xff;
    const dirtyRows = frame[3] >>> 16;
    const defFg = frame[4];
    const defBg = frame[5];
    gl.bindBuffer(gl.ARRAY_BUFFER, pane.vbo);
    if (cols !== pane.cols || rows !== pane.rows) {
      pane.cols = cols;
      pane.rows = rows;
      pane.data = new Uint32Array(cols * rows * 3);
      gl.bufferData(gl.ARRAY_BUFFER, pane.data.byteLength, gl.DYNAMIC_DRAW);
    }
    pane.bg = defBg;
    pane.cursor = visible ? { x: cursorX, y: cursorY, color: defFg } : null;
    const atlas = this.atlas;
    const data = pane.data;
    let src = HEADER_U32;
    for (let r = 0; r < dirtyRows; r++) {
      const y = frame[src++] & 0xffff;
      const rowStart = y * cols * 3;
      let dst = rowStart;
      let tail = false;
      for (let x = 0; x < cols; x++) {
        const cp = frame[src++];
        const fgWord = frame[src++];
        const bgWord = frame[src++];
        const flags = fgWord >>> 24;
        let fg = flags & FLAG_HAS_FG ? fgWord & 0xffffff : defFg;
        let bg = bgWord & BG_HAS ? bgWord & 0xffffff : defBg;
        if (flags & FLAG_INVERSE) {
          const t = fg;
          fg = bg;
          bg = t;
        }
        const wide = (flags & FLAG_WIDE) !== 0;
        let slot = 0;
        if (tail) slot = SLOT_SKIP;
        else if (cp > 32) slot = atlas.slot(cp, flags & 3, wide) | (wide ? SLOT_WIDE : 0);
        else if (wide) slot = SLOT_WIDE;
        tail = wide && !tail;
        data[dst++] = slot;
        data[dst++] = fg;
        data[dst++] = bg;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, rowStart * 4, data, rowStart, cols * 3);
    }
  }

  draw() {
    const gl = this.gl;
    const u = this.uniforms;
    this.atlas.sync();
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.uniform1i(u.uAtlas, 0);
    gl.uniform2f(u.uCellPx, this.cellW, this.cellH);
    gl.uniform2f(u.uAtlasCells, this.atlas.cols, this.atlas.rows);
    const height = this.canvas.height;
    for (const pane of this.panes) {
      if (pane.cols === 0) continue;
      const w = pane.cols * this.cellW;
      const h = pane.rows * this.cellH;
      const bottom = height - pane.y - h;
      gl.viewport(pane.x, bottom, w, h);
      gl.scissor(pane.x, bottom, w, h);
      gl.uniform2f(u.uGrid, pane.cols, pane.rows);
      gl.uniform2f(u.uViewPx, w, h);
      gl.bindVertexArray(pane.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, pane.cols * pane.rows);
      if (pane.cursor) {
        const c = pane.cursor.color;
        gl.scissor(
          pane.x + pane.cursor.x * this.cellW,
          bottom + h - (pane.cursor.y + 1) * this.cellH,
          Math.max(2, Math.round(this.dpr * 1.5)),
          this.cellH,
        );
        gl.clearColor((c & 255) / 255, ((c >> 8) & 255) / 255, ((c >> 16) & 255) / 255, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
  }

  flush() {
    const gl = this.gl;
    gl.scissor(0, 0, 1, 1);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }
}

export function splitFrames(buffer) {
  const view = new DataView(buffer);
  const frames = [];
  let off = 0;
  while (off < buffer.byteLength) {
    const len = view.getUint32(off, true);
    frames.push(new Uint32Array(buffer, off + 4, len / 4));
    off += 4 + len;
  }
  return frames;
}
