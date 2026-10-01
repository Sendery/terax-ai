import type { IconSvgElement } from "@hugeicons/react";
import { describe, expect, it } from "vitest";

import { iconSvgMarkup } from "./iconSvg";

const icon = [
  [
    "path",
    {
      d: "M1 2L3 4",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeWidth: "1.5",
      key: "0",
    },
  ],
  ["circle", { cx: "12", cy: "12", r: "2", fill: "currentColor", key: "1" }],
] as unknown as IconSvgElement;

describe("iconSvgMarkup", () => {
  it("serializes every element with kebab-case attributes and no React key", () => {
    const svg = iconSvgMarkup(icon, "#fff", 64);
    expect(svg).toContain('<path d="M1 2L3 4" stroke="#fff" stroke-linecap="round" stroke-width="1.5"/>');
    expect(svg).toContain('<circle cx="12" cy="12" r="2" fill="#fff"/>');
    expect(svg).not.toContain("key=");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24"')).toBe(true);
  });

  it("overrides the stroke width when asked", () => {
    expect(iconSvgMarkup(icon, "#000", 24, 2)).toContain('stroke-width="2"');
  });

  it("escapes attribute values", () => {
    const hostile = [["path", { d: 'M0"/><script' }]] as unknown as IconSvgElement;
    expect(iconSvgMarkup(hostile, "#000", 24)).toContain('d="M0&quot;/>&lt;script"');
  });
});
