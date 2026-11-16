import {
  assertCaptureCurrent,
  duringCapture,
  type CaptureScope,
} from "@/modules/capture/lib/captureLease";

export type FrameCaptureLease = {
  root: HTMLIFrameElement;
  snapshot: string;
  current: () => boolean;
  dispose: () => void;
};
type Provider = (scope: CaptureScope) => Promise<string>;
const providers = new WeakMap<HTMLIFrameElement, Provider>();
const preparing = new WeakSet<HTMLIFrameElement>();

export function registerFrameCaptureProvider(
  root: HTMLIFrameElement,
  provider: Provider,
): () => void {
  providers.set(root, provider);
  return () => {
    if (providers.get(root) === provider) providers.delete(root);
  };
}

export function visibleCaptureFrames(root: HTMLElement): HTMLIFrameElement[] {
  return Array.from(
    root.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-terax-capture-frame]",
    ),
  ).filter((frame) => {
    const style = window.getComputedStyle(frame);
    const bounds = frame.getBoundingClientRect();
    return (
      style.visibility === "visible" &&
      style.display !== "none" &&
      bounds.width > 0 &&
      bounds.height > 0
    );
  });
}

export async function prepareFrameCapture(
  root: HTMLIFrameElement,
  scope: CaptureScope,
): Promise<FrameCaptureLease> {
  assertCaptureCurrent(scope);
  const provider = providers.get(root);
  if (!provider) throw new Error("Graph capture is unavailable.");
  if (preparing.has(root))
    throw new Error("Graph capture is already in progress.");
  const bounds = () => {
    const rect = root.getBoundingClientRect();
    return JSON.stringify([rect.left, rect.top, rect.width, rect.height]);
  };
  const initial = bounds();
  let disposed = false;
  preparing.add(root);
  const current = () =>
    !disposed &&
    !scope.signal.aborted &&
    scope.current() &&
    root.isConnected &&
    providers.get(root) === provider &&
    bounds() === initial &&
    window.getComputedStyle(root).visibility === "visible";
  const dispose = () => {
    disposed = true;
    preparing.delete(root);
  };
  try {
    const snapshot = await duringCapture(
      provider({ signal: scope.signal, current }),
      {
        signal: scope.signal,
        current,
      },
    );
    if (
      !snapshot.startsWith("data:image/png;base64,") ||
      snapshot.length > 12 * 1024 * 1024
    )
      throw new Error("Graph capture image exceeds its limits.");
    return { root, snapshot, current, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
