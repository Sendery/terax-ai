import { resolveFontFamily } from "@/lib/fonts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { RendererFont } from "@/modules/terminal/gl/gridRenderer";
import { resolveTerminalFont, useTheme } from "@/modules/theme";
import { readTerminalTokens } from "@/styles/tokens";
import type { EngineColors } from "@/modules/terminal/gl/engineSession";
import {
  cssColorToBgr,
  engineColorsFromTokens,
  FALLBACK_ENGINE_COLORS,
} from "@/terminal-lab/lib/colors";
import { useEffect, useMemo, useState } from "react";

export type LabColors = {
  background: number;
  cursor: number;
  engine: EngineColors;
};

const FALLBACK: LabColors = {
  background: 0x141414,
  cursor: 0xd0d0d0,
  engine: FALLBACK_ENGINE_COLORS,
};

/** The terminal font exactly as an xterm.js tab would resolve it. */
export function useLabFont(): RendererFont {
  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  const fontWeight = usePreferencesStore((p) => p.terminalFontWeight);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  const { activeTheme, resolvedMode } = useTheme();
  const zoom = usePreferencesStore((p) => p.zoomLevel);
  const letterSpacing = usePreferencesStore((p) => p.terminalLetterSpacing);
  useEffect(() => {
    void usePreferencesStore.getState().init();
  }, []);
  return useMemo(() => {
    const font = resolveTerminalFont(
      { fontFamily, fontWeight, fontSize },
      activeTheme,
      resolvedMode,
    );
    return {
      family: resolveFontFamily(font.fontFamily),
      weight: font.fontWeight,
      size: Math.max(4, Math.round(font.fontSize * zoom)),
      letterSpacing,
    };
  }, [
    fontFamily,
    fontWeight,
    fontSize,
    activeTheme,
    resolvedMode,
    zoom,
    letterSpacing,
  ]);
}

/** Terminal background and cursor of the active theme, as 0x00BBGGRR. */
export function useLabColors(): LabColors {
  const { activeTheme, resolvedMode } = useTheme();
  const [colors, setColors] = useState<LabColors>(FALLBACK);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme is the re-read trigger
  useEffect(() => {
    // The provider writes the theme's variables in its own effect, which runs
    // after this one; read them a frame later.
    const id = requestAnimationFrame(() => {
      const engine = engineColorsFromTokens(readTerminalTokens());
      setColors({
        background: cssColorToBgr(engine.background, FALLBACK.background),
        cursor: cssColorToBgr(engine.cursor ?? "", FALLBACK.cursor),
        engine,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [activeTheme, resolvedMode]);
  return colors;
}
