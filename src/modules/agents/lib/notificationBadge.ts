import { iconFor, isTeraxAgent } from "./agentIcon";
import { iconSvgMarkup } from "./iconSvg";

const SIZE = 160;
const GLYPH = Math.round(SIZE * 0.58);
const NEUTRAL = "#52525b";
const MAX_CACHED = 64;

const cache = new Map<string, Promise<number[] | null>>();

/**
 * The notification image: the agent's logo, as the monitor draws it, on a disc
 * in the tab's colour. Rendered once per agent and colour and kept as PNG
 * bytes for `agent_notify`, which cannot rasterize an SVG itself.
 */
export function agentBadgePng(
  agent: string,
  accent: string | null,
): Promise<number[] | null> {
  const key = `${agent.toLowerCase()}|${accent ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= MAX_CACHED) cache.clear();
  const rendered = render(agent, accent).catch((e) => {
    console.warn("[terax] notification badge failed:", e);
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
    image.onerror = () => reject(new Error(`could not load ${src.slice(0, 40)}`));
    image.src = src;
  });
}

async function render(agent: string, accent: string | null): Promise<number[]> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");
  try {
    ctx.fillStyle = accent ?? NEUTRAL;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    const glyph = isTeraxAgent(agent)
      ? await loadImage("/logo.png")
      : await loadImage(
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
            iconSvgMarkup(iconFor(agent), "#ffffff", GLYPH, 1.75),
          )}`,
        );
    const offset = (SIZE - GLYPH) / 2;
    ctx.drawImage(glyph, offset, offset, GLYPH, GLYPH);
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
