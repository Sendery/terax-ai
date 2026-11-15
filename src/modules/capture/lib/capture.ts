import { invoke } from "@tauri-apps/api/core";
import { rasterizeElement, validateCaptureDimensions } from "./rasterize";
import {
  assertCaptureCurrent,
  duringCapture,
  prepareNativeCapture,
  type CaptureScope,
  type NativeCaptureLease,
} from "@/modules/capture/lib/captureLease";
import {
  type CaptureRequest,
  captureBlockReason,
  captureTargetSelector,
} from "./targets";

export const CAPTURE_PREPARE_EVENT = "terax:capture-prepare";

export type CaptureOutcome = {
  target: CaptureRequest["target"];
  tabId?: number;
  path: string;
  width: number;
  height: number;
  bytes: number;
  format: "png";
};

type PersistResult = {
  path: string;
  bytes: number;
};

const OVERLAY_SELECTORS = [
  "[data-radix-popper-content-wrapper]",
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
] as const;

export function resolveCaptureElement(
  request: CaptureRequest,
  activeTabId: number,
  root: Document = document,
): HTMLElement | null {
  if (request.target === "window") {
    return root.body;
  }
  if (request.target === "overlay") {
    for (const selector of OVERLAY_SELECTORS) {
      const matches = root.querySelectorAll<HTMLElement>(selector);
      const last = matches.item(matches.length - 1);
      if (last) return last;
    }
    return null;
  }
  if (request.target === "active-pane") {
    return root.querySelector<HTMLElement>(
      captureTargetSelector({ target: "pane", tabId: activeTabId }),
    );
  }
  return root.querySelector<HTMLElement>(captureTargetSelector(request));
}

export const CAPTURE_TIMEOUT_MS = 10_000;
export type CaptureContext = {
  tabs: readonly { id: number; private?: boolean }[];
  activeTabId: number;
};
const geometry = (element: Element): string => {
  const rect = element.getBoundingClientRect();
  return JSON.stringify([rect.left, rect.top, rect.width, rect.height]);
};
function nextFrame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let first = 0,
      second = 0;
    const cancel = () => {
      if (first) cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
      reject(signal.reason ?? new Error("Capture was cancelled."));
    };
    signal.addEventListener("abort", cancel, { once: true });
    first = requestAnimationFrame(() => {
      first = 0;
      second = requestAnimationFrame(() => {
        second = 0;
        signal.removeEventListener("abort", cancel);
        resolve();
      });
    });
    if (signal.aborted) cancel();
  });
}

export async function captureSurface(
  request: CaptureRequest,
  readContext: () => CaptureContext,
): Promise<CaptureOutcome> {
  const initial = readContext();
  const blocked = captureBlockReason(
    initial.tabs,
    initial.activeTabId,
    request,
  );
  if (blocked) throw new Error(blocked);
  const element = resolveCaptureElement(request, initial.activeTabId);
  if (!element)
    throw new Error(
      `Capture target ${JSON.stringify(request.target)} is not visible`,
    );
  const nativeRoots = Array.from(
    element.querySelectorAll<HTMLElement>('[data-terminal-engine="ghostty"]'),
  );
  const inactive =
    request.target === "pane" && request.tabId !== initial.activeTabId;
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error("Capture deadline exceeded.")),
    CAPTURE_TIMEOUT_MS,
  );
  let frozenGeometry: string | null = null;
  let frozenDpr: number | null = null;
  const baseCurrent = () => {
    const context = readContext();
    const roots = Array.from(
      element.querySelectorAll<HTMLElement>('[data-terminal-engine="ghostty"]'),
    );
    return (
      element.isConnected &&
      !captureBlockReason(context.tabs, context.activeTabId, request) &&
      resolveCaptureElement(request, context.activeTabId) === element &&
      roots.length === nativeRoots.length &&
      roots.every((root, index) => root === nativeRoots[index]) &&
      (frozenGeometry === null || geometry(element) === frozenGeometry) &&
      (frozenDpr === null || (window.devicePixelRatio || 1) === frozenDpr)
    );
  };
  const scope: CaptureScope = {
    signal: controller.signal,
    current: baseCurrent,
  };
  const leases: NativeCaptureLease[] = [];
  const pending: Promise<unknown>[] = [];
  try {
    assertCaptureCurrent(scope);
    window.dispatchEvent(
      new CustomEvent(CAPTURE_PREPARE_EVENT, { detail: request }),
    );
    await duringCapture(nextFrame(controller.signal), scope);
    frozenGeometry = geometry(element);
    frozenDpr = window.devicePixelRatio || 1;
    const rect = element.getBoundingClientRect();
    const dimensionError = validateCaptureDimensions(
      Math.ceil(rect.width),
      Math.ceil(rect.height),
    );
    if (dimensionError) throw new Error(dimensionError);
    if (request.target === "pane" || request.target === "active-pane") {
      for (const native of nativeRoots) {
        const hidden = window.getComputedStyle(native).visibility === "hidden";
        if (hidden !== inactive)
          throw new Error("Focus this terminal tab before capturing it.");
      }
    }
    if (inactive && nativeRoots.length) {
      // One-shot native staging preserves the frozen DPR. Bound its complete
      // target before requesting any full packet or allocating temporary pixels.
      const stagingError = validateCaptureDimensions(
        Math.ceil(rect.width * frozenDpr),
        Math.ceil(rect.height * frozenDpr),
      );
      if (stagingError) throw new Error(stagingError);
      const preparations = nativeRoots.map(async (root) => {
        const lease = await prepareNativeCapture(root, scope);
        leases.push(lease);
      });
      pending.push(...preparations);
      await duringCapture(Promise.all(preparations), scope);
    }
    const complete: CaptureScope = {
      signal: controller.signal,
      current: () => baseCurrent() && leases.every((lease) => lease.current()),
    };
    assertCaptureCurrent(complete);
    const raster = rasterizeElement(element, { leases, scope: complete });
    pending.push(raster);
    const image = await duringCapture(raster, complete);
    const bytes = new Uint8Array(
      await duringCapture(image.blob.arrayBuffer(), complete),
    );
    // No await may separate the live privacy/owner guard from persistence.
    assertCaptureCurrent(complete);
    const persisted = await duringCapture(
      invoke<PersistResult>("capture_persist", bytes),
      complete,
    );
    return {
      target: request.target,
      ...(request.tabId === undefined ? {} : { tabId: request.tabId }),
      path: persisted.path,
      width: image.width,
      height: image.height,
      bytes: persisted.bytes,
      format: "png",
    };
  } finally {
    clearTimeout(deadline);
    controller.abort(new Error("Capture scope closed."));
    await Promise.allSettled(pending);
    for (const lease of leases) {
      try {
        lease.dispose();
      } catch (error) {
        console.error("Capture resource cleanup failed", error);
      }
    }
  }
}
