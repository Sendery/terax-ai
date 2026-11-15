import type {
  TerminalRenderer,
  RendererFont,
} from "@/modules/terminal/gl/gridRenderer";
import { terminalEngineChoice } from "@/modules/terminal/gl/nativeSurface";
import type { EngineAppearanceColors } from "@/modules/terminal/gl/useTerminalEngineAppearance";
import { createContext, type RefObject, useContext } from "react";

export const nativeTerminalRequested =
  terminalEngineChoice(import.meta.env.VITE_TERAX_TERMINAL_ENGINE) ===
  "ghostty";

type Surface = {
  renderer: TerminalRenderer | null;
  root: RefObject<HTMLDivElement | null>;
  font: RendererFont;
  colors: EngineAppearanceColors;
  error: string | null;
  subscribeLayout: (listener: () => void) => () => void;
};
export const NativeSurfaceContext = createContext<Surface | null>(null);
export function useNativeTerminalSurface(): Surface | null {
  return useContext(NativeSurfaceContext);
}
