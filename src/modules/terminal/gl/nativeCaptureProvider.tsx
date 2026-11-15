import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  assertCaptureCurrent,
  duringCapture,
  type CaptureScope,
  type NativeCaptureLease,
} from "@/modules/capture/lib/captureLease";
import { BlockOverlaySnapshot } from "@/modules/terminal/block/BlockOverlay";
import type {
  EngineSession,
  NativeCaptureFrame,
} from "@/modules/terminal/gl/engineSession";
import {
  renderNativeCapturePixels,
  type NativeCaptureAppearance,
} from "@/modules/terminal/gl/nativeCapturePixels";
import { projectNativeBlocks } from "@/modules/terminal/gl/nativeBlocks";

const geometry = (element: Element): string => {
  const rect = element.getBoundingClientRect();
  return JSON.stringify([rect.left, rect.top, rect.width, rect.height]);
};

export async function captureNativePane(options: {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  session: Pick<EngineSession, "captureFrame">;
  appearance: NativeCaptureAppearance;
  blocks: boolean;
  promptReady: () => boolean;
  scope: CaptureScope;
}): Promise<NativeCaptureLease> {
  const { root, canvas, scope } = options;
  const rootGeometry = geometry(root),
    canvasGeometry = geometry(canvas);
  let captured: NativeCaptureFrame | null = null;
  let foreground: HTMLElement | undefined;
  let overlayRoot: Root | null = null;
  let excluded: Element[] = [];
  let disposed = false;
  let retained = false;
  const baseCurrent = () =>
    !disposed &&
    !scope.signal.aborted &&
    scope.current() &&
    root.isConnected &&
    (window.devicePixelRatio || 1) === options.appearance.dpr &&
    geometry(root) === rootGeometry &&
    geometry(canvas) === canvasGeometry;
  const current = () =>
    baseCurrent() &&
    Boolean(captured?.current()) &&
    (!foreground || foreground.isConnected);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      overlayRoot?.unmount();
    } finally {
      try {
        foreground?.remove();
      } finally {
        captured?.release();
        captured = null;
      }
    }
  };
  try {
    assertCaptureCurrent({ signal: scope.signal, current: baseCurrent });
    captured = await duringCapture(
      options.session.captureFrame({
        signal: scope.signal,
        blocks: options.blocks,
        current: baseCurrent,
      }),
      { signal: scope.signal, current: baseCurrent },
      (late) => late.release(),
    );
    assertCaptureCurrent({ signal: scope.signal, current });
    if (
      options.blocks &&
      (!captured.blocks ||
        captured.blocks.seq !== captured.frame.seq ||
        captured.blocks.viewportRows !== captured.frame.rows)
    )
      throw new Error("Terminal capture block projection is unavailable.");
    const snapshot = renderNativeCapturePixels(
      captured.frame,
      options.appearance,
      current,
    );
    if (options.blocks && captured.blocks) {
      excluded = Array.from(
        root.querySelectorAll("[data-native-block-overlay]"),
      );
      foreground = document.createElement("div");
      foreground.setAttribute("aria-hidden", "true");
      foreground.setAttribute("data-terax-capture-foreground", "");
      foreground.inert = true;
      foreground.style.cssText =
        "position:absolute;inset:0;visibility:hidden;pointer-events:none;z-index:10;";
      root.insertBefore(
        foreground,
        excluded[0] ?? root.querySelector('[role="alert"]'),
      );
      overlayRoot = createRoot(foreground);
      const visible = projectNativeBlocks(
        captured.blocks,
        options.appearance.cellSize.height,
        6,
      );
      flushSync(() =>
        overlayRoot?.render(
          <BlockOverlaySnapshot
            visible={visible}
            promptReady={options.promptReady()}
          />,
        ),
      );
      excluded.push(foreground);
    }
    assertCaptureCurrent({ signal: scope.signal, current });
    retained = true;
    return { root, canvas, snapshot, excluded, foreground, current, dispose };
  } finally {
    if (!retained) dispose();
  }
}
