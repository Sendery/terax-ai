import { invoke } from "@tauri-apps/api/core";
import { rasterizeElement } from "./rasterize";
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export async function captureSurface(
  request: CaptureRequest,
  tabs: readonly { id: number; private?: boolean }[],
  activeTabId: number,
): Promise<CaptureOutcome> {
  const blocked = captureBlockReason(tabs, activeTabId, request);
  if (blocked) throw new Error(blocked);

  const element = resolveCaptureElement(request, activeTabId);
  if (!element) {
    throw new Error(`Capture target "${request.target}" is not visible`);
  }

  window.dispatchEvent(
    new CustomEvent(CAPTURE_PREPARE_EVENT, { detail: request }),
  );
  await nextFrame();

  const image = await rasterizeElement(element);
  const bytes = new Uint8Array(await image.blob.arrayBuffer());
  const persisted = await invoke<PersistResult>("capture_persist", bytes);
  return {
    target: request.target,
    ...(request.tabId === undefined ? {} : { tabId: request.tabId }),
    path: persisted.path,
    width: image.width,
    height: image.height,
    bytes: persisted.bytes,
    format: "png",
  };
}
