import {
  GridRenderer,
  type GridRendererOptions,
  type TerminalRenderer,
} from "@/modules/terminal/gl/gridRenderer";

export async function createTerminalRenderer(
  makeCanvas: () => HTMLCanvasElement,
  options: GridRendererOptions,
  webgl: boolean,
): Promise<TerminalRenderer> {
  if (webgl) {
    try {
      return new GridRenderer(makeCanvas(), options);
    } catch {}
  }
  const { CanvasRenderer } = await import(
    "@/modules/terminal/gl/canvasRenderer"
  );
  return new CanvasRenderer(makeCanvas(), options);
}
