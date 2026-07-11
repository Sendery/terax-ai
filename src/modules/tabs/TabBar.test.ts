import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level regression tests for TabBar.tsx accessibility in the Color
 * submenu. Rendering the full component requires a Tauri + Radix context that
 * is not available in vitest. Instead we verify the static JSX structure still
 * carries the correct primitives -- if a future change reverts to raw buttons
 * or drops labels, these tests fail.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "TabBar.tsx"), "utf8");

describe("TabBar color submenu accessibility", () => {
  it("uses ContextMenuRadioGroup instead of a plain div for the color group", () => {
    expect(src).toMatch(/ContextMenuRadioGroup/);
  });

  it("uses ContextMenuRadioItem for each palette entry, not raw button elements", () => {
    expect(src).toMatch(/ContextMenuRadioItem/);
    // There must be no 16px swatch-only button inside the color submenu section.
    // We detect the anti-pattern: a <button ... size-4 ...> used as a color dot.
    const colorSection = src.slice(
      src.indexOf("ContextMenuRadioGroup"),
      src.indexOf("Reset color"),
    );
    expect(colorSection).not.toMatch(/\bbutton\b[^>]*size-4/);
  });

  it("renders TAB_COLOR_LABEL text alongside each swatch in the radio item", () => {
    expect(src).toMatch(/TAB_COLOR_LABEL\[color\]/);
  });

  it("exposes the assigned color in the tab trigger accessible name or description", () => {
    // The trigger must carry aria-label or aria-description mentioning the color
    // when one is assigned, so screen readers announce "shell - teal" etc.
    const hasAriaLabel = /aria-label=\{[^}]*color/.test(src);
    const hasAriaDescription = /aria-description=\{[^}]*color/.test(src);
    expect(hasAriaLabel || hasAriaDescription).toBe(true);
  });
});
