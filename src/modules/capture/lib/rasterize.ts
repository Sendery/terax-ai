export const MAX_CAPTURE_WIDTH = 7_680;
export const MAX_CAPTURE_HEIGHT = 4_320;
export const MAX_CAPTURE_PIXELS = 16_777_216;
export const MAX_FONT_BYTES = 8 * 1024 * 1024;
const MIN_CAPTURE_SCALE = 0.1;

export function validateCaptureDimensions(
  width: number,
  height: number,
): string | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_CAPTURE_WIDTH ||
    height > MAX_CAPTURE_HEIGHT ||
    width * height > MAX_CAPTURE_PIXELS
  ) {
    return "Capture dimensions exceed the visual capture limits";
  }
  return null;
}

export function captureScaleFor(
  width: number,
  height: number,
  devicePixelRatio: number,
): number {
  const requested = Math.max(MIN_CAPTURE_SCALE, devicePixelRatio);
  const pixels = width * height;
  if (pixels * requested * requested <= MAX_CAPTURE_PIXELS) return requested;
  const fitted = Math.sqrt(MAX_CAPTURE_PIXELS / pixels);
  return Math.max(MIN_CAPTURE_SCALE, Math.min(requested, fitted * 0.999));
}

export function buildSvgMarkup(
  width: number,
  height: number,
  serializedHtml: string,
  fontCss: string,
): string {
  const style = fontCss ? `<style>${fontCss}</style>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    style +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">` +
    serializedHtml +
    "</div></foreignObject></svg>"
  );
}

type CanvasSnapshotProvider = () => string | null;

const canvasProviders = new WeakMap<
  HTMLCanvasElement,
  CanvasSnapshotProvider
>();

// Lets surfaces with non-preserved drawing buffers (xterm webgl) register a
// provider that forces a synchronous redraw before reading pixels.
export function registerCanvasSnapshotProvider(
  canvas: HTMLCanvasElement,
  provider: CanvasSnapshotProvider,
): () => void {
  canvasProviders.set(canvas, provider);
  return () => {
    if (canvasProviders.get(canvas) === provider) {
      canvasProviders.delete(canvas);
    }
  };
}

async function drawOverlay(
  context: CanvasRenderingContext2D,
  overlay: CanvasOverlay,
): Promise<void> {
  if (overlay.snapshot) {
    try {
      const url = overlay.snapshot;
      if (url) {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("provider image failed"));
          image.src = url;
        });
        context.drawImage(
          image,
          overlay.x,
          overlay.y,
          overlay.width,
          overlay.height,
        );
        return;
      }
    } catch (error) {
      if (overlay.required) throw error;
      // fall through to the direct read
    }
  }
  try {
    context.drawImage(
      overlay.canvas,
      overlay.x,
      overlay.y,
      overlay.width,
      overlay.height,
    );
  } catch {
    // An unreadable canvas leaves its region as rendered by the clone.
  }
}

export type CanvasOverlay = {
  canvas: HTMLCanvasElement;
  snapshot?: string | null;
  required?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

// WebKit rasterizes foreignObject before nested data-URL images load, so
// canvas pixels are composited directly onto the output instead.
export function collectCanvasOverlays(
  root: HTMLElement,
  rootRect: DOMRect,
): CanvasOverlay[] {
  const overlays: CanvasOverlay[] = [];
  for (const canvas of Array.from(root.querySelectorAll("canvas"))) {
    if (canvas.hasAttribute("data-terax-capture-proxy-source")) continue;
    // visibility:hidden canvases keep layout and pixels (hidden tabs stay
    // mounted), so only zero-layout canvases (display:none) are skipped.
    const required = canvas.hasAttribute("data-terax-capture-required");
    if (
      required &&
      canvas.closest<HTMLElement>("[data-terminal-engine]")?.style
        .visibility === "hidden"
    )
      continue;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    let snapshot: string | null = null;
    try {
      snapshot = canvasProviders.get(canvas)?.() ?? null;
    } catch (error) {
      if (required) throw error;
    }
    if (required && !snapshot)
      throw new Error("Terminal capture is no longer available.");
    overlays.push({
      canvas,
      snapshot,
      required,
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
    });
  }
  return overlays;
}

type ForegroundElement = {
  clip?: { x: number; y: number; width: number; height: number };
  element: HTMLElement;
  x: number;
  y: number;
  width: number;
  height: number;
};
type ForegroundImage = Omit<ForegroundElement, "element"> & {
  image: CanvasImageSource;
};
const FOREGROUND_SELECTOR = [
  "[data-terax-capture-foreground]",
  "[data-radix-popper-content-wrapper]",
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
].join(",");
export function collectForegroundElements(
  root: HTMLElement,
  rootRect: DOMRect,
  overlays: CanvasOverlay[],
): ForegroundElement[] {
  if (!overlays.length) return [];
  const candidates: ForegroundElement[] = [];
  let pixels = 0;
  for (const element of Array.from(
    root.querySelectorAll<HTMLElement>(FOREGROUND_SELECTOR),
  )) {
    if (
      element.closest<HTMLElement>("[data-terminal-engine]")?.style
        .visibility === "hidden" ||
      element.style?.visibility === "hidden"
    )
      continue;
    const computed = window.getComputedStyle(element);
    if (computed.visibility !== "visible" || computed.display === "none")
      continue;
    const rect = element.getBoundingClientRect();
    const x = rect.left - rootRect.left,
      y = rect.top - rootRect.top;
    const width = Math.ceil(rect.width),
      height = Math.ceil(rect.height);
    if (
      width < 1 ||
      height < 1 ||
      !overlays.some(
        (item) =>
          x < item.x + item.width &&
          x + width > item.x &&
          y < item.y + item.height &&
          y + height > item.y,
      )
    )
      continue;
    const error = validateCaptureDimensions(width, height);
    if (error) throw new Error(error);
    if (candidates.some((parent) => parent.element.contains(element))) continue;
    pixels += width * height;
    if (candidates.length >= 128 || pixels > MAX_CAPTURE_PIXELS * 4)
      throw new Error("Capture foreground exceeds its limits");
    let left = 0,
      top = 0,
      right = rootRect.width,
      bottom = rootRect.height;
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = window.getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (/^(hidden|clip|auto|scroll|overlay)$/.test(style.overflowX)) {
        left = Math.max(left, bounds.left - rootRect.left);
        right = Math.min(right, bounds.left - rootRect.left + bounds.width);
      }
      if (/^(hidden|clip|auto|scroll|overlay)$/.test(style.overflowY)) {
        top = Math.max(top, bounds.top - rootRect.top);
        bottom = Math.min(bottom, bounds.top - rootRect.top + bounds.height);
      }
      if (parent === root) break;
    }
    if (right <= left || bottom <= top) continue;
    candidates.push({
      element,
      x,
      y,
      width,
      height,
      clip: { x: left, y: top, width: right - left, height: bottom - top },
    });
  }
  return candidates.filter(
    (item) =>
      !candidates.some(
        (parent) => parent !== item && parent.element.contains(item.element),
      ),
  );
}
export async function compositeCaptureLayers(
  context: CanvasRenderingContext2D,
  base: CanvasImageSource,
  overlays: CanvasOverlay[],
  foregrounds: ForegroundImage[],
): Promise<void> {
  context.drawImage(base, 0, 0);
  for (const overlay of overlays) await drawOverlay(context, overlay);
  if (!foregrounds.length || !overlays.length) return;
  context.save();
  try {
    context.beginPath();
    for (const overlay of overlays)
      context.rect(overlay.x, overlay.y, overlay.width, overlay.height);
    context.clip();
    for (const foreground of foregrounds) {
      context.save();
      try {
        if (foreground.clip) {
          const { x, y, width, height } = foreground.clip;
          context.beginPath();
          context.rect(x, y, width, height);
          context.clip();
        }
        context.drawImage(
          foreground.image,
          foreground.x,
          foreground.y,
          foreground.width,
          foreground.height,
        );
      } finally {
        context.restore();
      }
    }
  } finally {
    context.restore();
  }
}

const SKIPPED_STYLE_PROPERTIES = new Set(["cursor", "pointer-events"]);

function inlineComputedStyles(
  source: Element,
  clone: Element,
  forceVisible: boolean,
): void {
  if (clone instanceof HTMLElement || clone instanceof SVGElement) {
    const computed = window.getComputedStyle(source);
    let cssText = "";
    for (let i = 0; i < computed.length; i += 1) {
      const property = computed.item(i);
      if (SKIPPED_STYLE_PROPERTIES.has(property)) continue;
      let value = computed.getPropertyValue(property);
      // Hidden-but-mounted surfaces (inactive tabs) inherit visibility:hidden;
      // baking it into every clone node would render the capture blank.
      if (forceVisible && property === "visibility" && value === "hidden") {
        value = "visible";
      }
      cssText += `${property}:${value};`;
    }
    clone.setAttribute("style", cssText);
    clone.removeAttribute("class");
  }
  const sourceChildren = source.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < sourceChildren.length; i += 1) {
    const sourceChild = sourceChildren[i];
    const cloneChild = cloneChildren[i];
    if (sourceChild && cloneChild) {
      inlineComputedStyles(sourceChild, cloneChild, forceVisible);
    }
  }
}

function stripCanvases(clone: Element): void {
  for (const canvas of Array.from(clone.querySelectorAll("canvas"))) {
    canvas.remove();
  }
}

function syncInputState(source: Element, clone: Element): void {
  const sourceInputs = Array.from(
    source.querySelectorAll("input, textarea, select"),
  );
  const cloneInputs = Array.from(
    clone.querySelectorAll("input, textarea, select"),
  );
  for (let i = 0; i < cloneInputs.length; i += 1) {
    const original = sourceInputs[i];
    const cloned = cloneInputs[i];
    if (!original || !cloned) continue;
    if (
      original instanceof HTMLInputElement &&
      cloned instanceof HTMLInputElement
    ) {
      cloned.setAttribute(
        "value",
        original.type === "password"
          ? "\u2022".repeat(original.value.length)
          : original.value,
      );
      if (original.checked) cloned.setAttribute("checked", "checked");
    } else if (
      original instanceof HTMLTextAreaElement &&
      cloned instanceof HTMLTextAreaElement
    ) {
      cloned.textContent = original.value;
    }
  }
}

let cachedFontCss: string | null = null;

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > MAX_FONT_BYTES) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function collectFontCss(): Promise<string> {
  if (cachedFontCss !== null) return cachedFontCss;
  const chunks: string[] = [];
  let totalBytes = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const src = rule.style.getPropertyValue("src");
      const match = src.match(/url\(["']?([^"')]+)["']?\)/);
      if (!match) continue;
      const resolved = new URL(match[1], sheet.href ?? document.baseURI);
      if (resolved.origin !== window.location.origin) continue;
      const dataUrl = await fetchAsDataUrl(resolved.href);
      if (!dataUrl) continue;
      totalBytes += dataUrl.length;
      if (totalBytes > MAX_FONT_BYTES) break;
      chunks.push(rule.cssText.replace(match[0], `url("${dataUrl}")`));
    }
  }
  cachedFontCss = chunks.join("\n");
  return cachedFontCss;
}

export type CaptureImage = {
  blob: Blob;
  width: number;
  height: number;
};

function freezeElement(
  element: HTMLElement,
  width: number,
  height: number,
  forceVisible = window.getComputedStyle(element).visibility === "hidden",
): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  inlineComputedStyles(element, clone, forceVisible);
  stripCanvases(clone);
  syncInputState(element, clone);
  clone.style.margin = "0";
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  // The capture viewport already equals the element's bounding box, so
  // positioning offsets (popper transforms, absolute insets) must not
  // re-apply inside the clone.
  clone.style.transform = "none";
  clone.style.position = "static";
  clone.style.inset = "auto";
  // Inactive panes stay mounted but hidden; the capture clone must render.
  if (forceVisible) clone.style.visibility = "visible";
  clone.style.display =
    clone.style.display === "none" ? "block" : clone.style.display;

  return clone;
}
async function markupImage(
  width: number,
  height: number,
  clone: HTMLElement,
  fontCss: string,
): Promise<HTMLImageElement> {
  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = buildSvgMarkup(width, height, serialized, fontCss);
  const image = new Image();
  image.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Capture rasterization failed"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  return image;
}

export async function rasterizeElement(
  element: HTMLElement,
): Promise<CaptureImage> {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const dimensionError = validateCaptureDimensions(width, height);
  if (dimensionError) throw new Error(dimensionError);

  const overlays = collectCanvasOverlays(element, rect);
  const clone = freezeElement(element, width, height);
  // Freeze foreground DOM at the same time as the required native snapshots.
  const foregrounds = collectForegroundElements(element, rect, overlays).map(
    (item) => ({
      ...item,
      clone: freezeElement(item.element, item.width, item.height, false),
    }),
  );
  const fontCss = await collectFontCss();
  const image = await markupImage(width, height, clone, fontCss);
  const foregroundImages = await Promise.all(
    foregrounds.map(async (item) => ({
      image: await markupImage(item.width, item.height, item.clone, fontCss),
      clip: item.clip,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })),
  );

  const scale = captureScaleFor(width, height, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Capture canvas context unavailable");
  const background = window.getComputedStyle(document.body).backgroundColor;
  if (background && background !== "rgba(0, 0, 0, 0)") {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.scale(scale, scale);
  await compositeCaptureLayers(context, image, overlays, foregroundImages);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Capture PNG encoding failed"));
    }, "image/png");
  });
  return { blob, width: canvas.width, height: canvas.height };
}
