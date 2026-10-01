import type { IconSvgElement } from "@hugeicons/react";

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/**
 * A standalone SVG document for a hugeicons glyph, drawn in `color`, so it can
 * be rasterized outside React (a native notification image has no DOM).
 */
export function iconSvgMarkup(
  icon: IconSvgElement,
  color: string,
  size: number,
  strokeWidth?: number,
): string {
  const children = icon
    .map(([tag, attrs]) => {
      const parts: string[] = [];
      for (const [name, raw] of Object.entries(attrs)) {
        if (name === "key") continue;
        let value = String(raw);
        if (value === "currentColor") value = color;
        if (name === "strokeWidth" && strokeWidth !== undefined) {
          value = String(strokeWidth);
        }
        parts.push(`${kebab(name)}="${escapeAttr(value)}"`);
      }
      return `<${tag} ${parts.join(" ")}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">${children}</svg>`;
}
