import type {
  DecodedGraphics,
  GraphicImage,
  GraphicPlacement,
} from "@/modules/terminal/gl/graphicsCodec";
import { RenderCapacityError } from "@/modules/terminal/gl/renderCapacity";
const MAX_WINDOW_BYTES = 128 * 1024 * 1024;
type Image = GraphicImage & { texture: WebGLTexture | null };
type PaneImages = {
  frame: DecodedGraphics;
  images: Map<string, Image>;
  bytes: number;
};
const VERTEX = `#version 300 es
precision highp float;
uniform vec4 uDest;
uniform vec4 uSource;
uniform vec2 uView;
out vec2 vUv;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 clip = (uDest.xy + corner * uDest.zw) / uView * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUv = uSource.xy + corner * uSource.zw;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uImage;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uImage,vUv); }`;
export class GraphicsRenderer {
  private panes = new Map<object, PaneImages>();
  private bytes = 0;
  private program: WebGLProgram | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  constructor(private readonly gl: WebGL2RenderingContext) {}
  apply(pane: object, frame: DecodedGraphics | undefined): void {
    if (!frame || frame.placements.length === 0) {
      this.remove(pane);
      return;
    }
    const previous = this.panes.get(pane);
    const uploads = new Map(frame.images.map((image) => [image.key, image]));
    const references = new Map<string, GraphicImage>();
    let bytes = 0;
    for (const placement of frame.placements) {
      if (references.has(placement.key)) continue;
      const image =
        uploads.get(placement.key) ?? previous?.images.get(placement.key);
      if (!image || image.id !== placement.id)
        throw new Error("missing native graphic image");
      bytes += image.pixels.byteLength;
      references.set(image.key, image);
    }
    if (this.bytes - (previous?.bytes ?? 0) + bytes > MAX_WINDOW_BYTES)
      throw new RenderCapacityError();
    this.init();
    const images = new Map<string, Image>();
    for (const image of references.values()) {
      const old = previous?.images.get(image.key);
      if (
        old &&
        (old.id !== image.id ||
          old.width !== image.width ||
          old.height !== image.height)
      )
        throw new Error("native graphic generation reused");
      images.set(
        image.key,
        old ?? { ...image, pixels: image.pixels.slice(), texture: null },
      );
    }
    for (const placement of frame.placements) {
      const image = images.get(placement.key);
      if (!image) throw new Error("missing native graphic image");
      if (
        placement.sourceX + placement.sourceWidth > image.width ||
        placement.sourceY + placement.sourceHeight > image.height
      )
        throw new Error("invalid native graphic crop");
    }
    try {
      for (const image of images.values()) this.upload(image);
    } catch (error) {
      for (const image of images.values())
        if (image !== previous?.images.get(image.key) && image.texture)
          this.gl.deleteTexture(image.texture);
      throw error;
    }
    for (const image of previous?.images.values() ?? [])
      if (image !== images.get(image.key) && image.texture)
        this.gl.deleteTexture(image.texture);
    this.bytes += bytes - (previous?.bytes ?? 0);
    this.panes.set(pane, { frame: { ...frame, images: [] }, images, bytes });
  }
  has(pane: object): boolean {
    return this.panes.has(pane);
  }
  draw(
    pane: object,
    layer: 0 | 1 | 2,
    cellWidth: number,
    cellHeight: number,
    width: number,
    height: number,
  ): void {
    const state = this.panes.get(pane);
    if (!state || !this.program) return;
    const gl = this.gl;
    // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL call, not a React hook
    gl.useProgram(this.program);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.activeTexture(gl.TEXTURE2);
    gl.uniform1i(this.uniforms.uImage, 2);
    gl.uniform2f(this.uniforms.uView, width, height);
    for (const placement of state.frame.placements) {
      const zLayer = placement.z < -1073741824 ? 0 : placement.z < 0 ? 1 : 2;
      if (layer !== zLayer) continue;
      const image = state.images.get(placement.key);
      if (!image) continue;
      this.upload(image);
      gl.bindTexture(gl.TEXTURE_2D, image.texture);
      this.geometry(placement, state.frame, image, cellWidth, cellHeight);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
  }
  private geometry(
    p: GraphicPlacement,
    f: DecodedGraphics,
    image: Image,
    cw: number,
    ch: number,
  ): void {
    const gl = this.gl;
    gl.uniform4f(
      this.uniforms.uDest,
      (p.col + p.offsetX / f.cellWidth) * cw,
      (p.row + p.offsetY / f.cellHeight) * ch,
      (p.width / f.cellWidth) * cw,
      (p.height / f.cellHeight) * ch,
    );
    gl.uniform4f(
      this.uniforms.uSource,
      p.sourceX / image.width,
      p.sourceY / image.height,
      p.sourceWidth / image.width,
      p.sourceHeight / image.height,
    );
  }
  private upload(image: Image): void {
    if (image.texture) return;
    const gl = this.gl;
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (image.width > limit || image.height > limit)
      throw new RenderCapacityError();
    const texture = gl.createTexture();
    if (!texture) throw new RenderCapacityError();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      image.width,
      image.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image.pixels,
    );
    if (gl.getError() !== gl.NO_ERROR) {
      gl.deleteTexture(texture);
      throw new RenderCapacityError();
    }
    image.texture = texture;
  }
  private init(): void {
    if (this.program) return;
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new RenderCapacityError();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) {
        gl.deleteProgram(program);
        throw new RenderCapacityError();
      }
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      if (ok) gl.attachShader(program, shader);
      gl.deleteShader(shader);
      if (!ok) {
        gl.deleteProgram(program);
        throw new RenderCapacityError();
      }
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      throw new RenderCapacityError();
    }
    this.program = program;
    for (const name of ["uDest", "uSource", "uView", "uImage"])
      this.uniforms[name] = gl.getUniformLocation(program, name);
  }
  remove(pane: object): void {
    const previous = this.panes.get(pane);
    if (!previous) return;
    for (const image of previous.images.values())
      if (image.texture) this.gl.deleteTexture(image.texture);
    this.bytes -= previous.bytes;
    this.panes.delete(pane);
  }
  dropContext(): void {
    this.program = null;
    this.uniforms = {};
    this.panes.clear();
    this.bytes = 0;
  }
  dispose(): void {
    for (const pane of this.panes.keys()) this.remove(pane);
    if (this.program) this.gl.deleteProgram(this.program);
    this.program = null;
  }
}
