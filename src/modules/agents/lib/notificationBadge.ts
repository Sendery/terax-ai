import { iconFor, isTeraxAgent } from "./agentIcon";
import { iconSvgMarkup } from "./iconSvg";
import { extractLogoMark } from "./logoMark";
import { TONE_MARK } from "./marks";
import type { NotificationTone } from "./types";

const SIZE = 256;
const RADIUS = 56;
const NEUTRAL = "#3f3f46";
const MARK_BOX = 184;
const BADGE = 72;
const BADGE_RING = 5;
const BADGE_X = SIZE - BADGE - 16;
const TOP_BADGE_Y = 16;
const BOTTOM_BADGE_Y = SIZE - BADGE - 16;
const MAX_CACHED = 96;

const cache = new Map<string, Promise<number[] | null>>();
let markCanvas: Promise<HTMLCanvasElement> | null = null;

/**
 * The notification's icon, which macOS shows in place of the app icon: the
 * Terax ribbon on a squircle in the tab's colour, the agent's logo in the top
 * right corner and the state's mark in the bottom right, so tab, agent and
 * state read from the icon alone. Rendered once per combination and kept as
 * PNG bytes for `agent_notify`, which cannot rasterize an SVG itself.
 */
export function agentBadgePng(
  agent: string,
  accent: string | null,
  tone: NotificationTone,
): Promise<number[] | null> {
  const key = `${agent.toLowerCase()}|${accent ?? ""}|${tone}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= MAX_CACHED) cache.clear();
  const rendered = render(agent, accent, tone).catch((e) => {
    console.warn("[terax] notification icon failed:", e);
    cache.delete(key);
    return null;
  });
  cache.set(key, rendered);
  return rendered;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`could not load ${src.slice(0, 40)}`));
    image.src = src;
  });
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas 2D context unavailable");
  return ctx;
}

/** The ribbon alone, cut out of the app logo once per session. */
function logoMark(): Promise<HTMLCanvasElement> {
  if (!markCanvas) {
    markCanvas = loadImage("/logo.png").then((logo) => {
      const canvas = document.createElement("canvas");
      canvas.width = logo.naturalWidth;
      canvas.height = logo.naturalHeight;
      const ctx = context(canvas);
      ctx.drawImage(logo, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      extractLogoMark(pixels.data, canvas.width, canvas.height);
      ctx.putImageData(pixels, 0, 0);
      return canvas;
    });
    markCanvas.catch(() => {
      markCanvas = null;
    });
  }
  return markCanvas;
}

function corner(ctx: CanvasRenderingContext2D, y: number): void {
  const r = BADGE / 2;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(BADGE_X + r, y + r, r + BADGE_RING, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#18181b";
  ctx.beginPath();
  ctx.arc(BADGE_X + r, y + r, r, 0, Math.PI * 2);
  ctx.fill();
}

async function render(
  agent: string,
  accent: string | null,
  tone: NotificationTone,
): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = context(canvas);
  try {
    ctx.fillStyle = accent ?? NEUTRAL;
    ctx.beginPath();
    ctx.roundRect(0, 0, SIZE, SIZE, RADIUS);
    ctx.fill();
    // A soft top light, so a flat tab colour still reads as an app icon.
    const sheen = ctx.createLinearGradient(0, 0, 0, SIZE);
    sheen.addColorStop(0, "rgba(255,255,255,0.18)");
    sheen.addColorStop(1, "rgba(0,0,0,0.12)");
    ctx.fillStyle = sheen;
    ctx.fill();

    const mark = await logoMark();
    const scale = MARK_BOX / Math.max(mark.width, mark.height);
    const w = mark.width * scale;
    const h = mark.height * scale;
    // Left-justified, so the right column is free for the two corner marks.
    ctx.drawImage(mark, 6, (SIZE - h) / 2, w, h);

    // The ribbon already says Terax, so its own agent needs no second logo.
    if (!isTeraxAgent(agent)) {
      corner(ctx, TOP_BADGE_Y);
      const glyph = await loadImage(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
          iconSvgMarkup(iconFor(agent), "#ffffff", BADGE, 1.75),
        )}`,
      );
      const inset = BADGE * 0.2;
      ctx.drawImage(
        glyph,
        BADGE_X + inset,
        TOP_BADGE_Y + inset,
        BADGE - inset * 2,
        BADGE - inset * 2,
      );
    }

    corner(ctx, BOTTOM_BADGE_Y);
    ctx.font = `${Math.round(BADGE * 0.56)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      TONE_MARK[tone],
      BADGE_X + BADGE / 2,
      BOTTOM_BADGE_Y + BADGE / 2 + BADGE * 0.04,
    );

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))),
        "image/png",
      ),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
