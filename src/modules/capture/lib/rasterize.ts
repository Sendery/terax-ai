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
  const provider = canvasProviders.get(overlay.canvas);
  if (provider) {
    try {
      const url = provider();
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
    } catch {
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
  x: number;
  y: number;
  width: number;
  height: number;
};

// WebKit rasterizes foreignObject before nested data-URL images load, so
// canvas pixels are composited directly onto the output instead.
function collectCanvasOverlays(
  root: HTMLElement,
  rootRect: DOMRect,
): CanvasOverlay[] {
  const overlays: CanvasOverlay[] = [];
  for (const canvas of Array.from(root.querySelectorAll("canvas"))) {
    // visibility:hidden canvases keep layout and pixels (hidden tabs stay
    // mounted), so only zero-layout canvases (display:none) are skipped.
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    overlays.push({
      canvas,
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
    });
  }
  return overlays;
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

export async function rasterizeElement(
  element: HTMLElement,
): Promise<CaptureImage> {
  const rect = element.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const dimensionError = validateCaptureDimensions(width, height);
  if (dimensionError) throw new Error(dimensionError);

  const overlays = collectCanvasOverlays(element, rect);
  const clone = element.cloneNode(true) as HTMLElement;
  const forceVisible =
    window.getComputedStyle(element).visibility === "hidden";
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
  clone.style.visibility = "visible";
  clone.style.display =
    clone.style.display === "none" ? "block" : clone.style.display;

  const fontCss = await collectFontCss();
  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = buildSvgMarkup(width, height, serialized, fontCss);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const image = new Image();
  image.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Capture rasterization failed"));
    image.src = svgUrl;
  });

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
  context.drawImage(image, 0, 0);
  for (const overlay of overlays) {
    await drawOverlay(context, overlay);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Capture PNG encoding failed"));
    }, "image/png");
  });
  return { blob, width: canvas.width, height: canvas.height };
}
