import { validateCaptureDimensions } from "@/modules/capture/lib/rasterize";
import { CanvasRenderer } from "@/modules/terminal/gl/canvasRenderer";
import type { DecodedFrame } from "@/modules/terminal/gl/frameCodec";
import type { GridRendererOptions } from "@/modules/terminal/gl/gridRenderer";

export type NativeCaptureAppearance = Pick<
  GridRendererOptions,
  "font" | "background" | "cursorFallback" | "minimumContrastRatio"
> & {
  width: number;
  height: number;
  dpr: number;
  cellSize: { width: number; height: number };
  focused: boolean;
};

/** Reconstructs one validated full packet without attaching the live renderer. */
export function renderNativeCapturePixels(
  frame: DecodedFrame,
  appearance: NativeCaptureAppearance,
  current: () => boolean,
): string {
  if (!current()) throw new Error("Terminal capture is no longer available.");
  if (!frame.full)
    throw new Error("Terminal capture requires a complete frame.");
  if ((window.devicePixelRatio || 1) !== appearance.dpr)
    throw new Error("Terminal capture appearance changed.");
  const error = validateCaptureDimensions(
    Math.max(1, Math.round(appearance.width * appearance.dpr)),
    Math.max(1, Math.round(appearance.height * appearance.dpr)),
  );
  if (error) throw new Error(error);
  const canvas = document.createElement("canvas");
  let renderer: CanvasRenderer | null = null;
  let failure: unknown = null;
  try {
    renderer = new CanvasRenderer(canvas, appearance);
    const cell = renderer.cellSize;
    if (
      Math.abs(cell.width - appearance.cellSize.width) > 0.000001 ||
      Math.abs(cell.height - appearance.cellSize.height) > 0.000001 ||
      Math.min(1000, Math.max(1, Math.floor(appearance.width / cell.width))) !==
        frame.cols ||
      Math.min(
        500,
        Math.max(1, Math.floor(appearance.height / cell.height)),
      ) !== frame.rows
    )
      throw new Error("Terminal capture appearance or geometry changed.");
    renderer.resize(appearance.width, appearance.height);
    const pane = renderer.addPane({
      onNeedFullFrame: () => {
        failure = new Error("Terminal capture frame is incomplete.");
      },
      onDrawn: () => {},
      onError: (error) => {
        failure = error;
      },
    });
    renderer.setPaneRect(pane, {
      x: 0,
      y: 0,
      width: appearance.width,
      height: appearance.height,
    });
    renderer.setPaneFocused(pane, appearance.focused);
    if (renderer.applyFrame(pane, frame) !== "applied")
      throw failure ?? new Error("Terminal capture frame is incomplete.");
    const snapshot = renderer.snapshot();
    if (
      failure ||
      !pane.grid ||
      !pane.header ||
      !snapshot?.startsWith("data:image/png;")
    )
      throw failure ?? new Error("Terminal capture pixels are unavailable.");
    if (!current()) throw new Error("Terminal capture is no longer available.");
    return snapshot;
  } finally {
    try {
      renderer?.dispose();
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
}
