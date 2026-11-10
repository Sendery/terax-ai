import type { RendererFont } from "@/modules/terminal/gl/gridRenderer";
import { buildTerminalTheme } from "@/styles/terminalTheme";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

export function labXterm(
  stage: HTMLElement,
  font: RendererFont,
  cols: number,
  rows: number,
  count: number,
) {
  const host = document.createElement("div");
  host.style.cssText = `overflow:hidden;position:relative;width:${count === 1 ? 100 : 25}%;height:${count === 1 ? 100 : 100 / Math.ceil(count / 4)}%;`;
  stage.appendChild(host);
  const term = new Terminal({
    cols,
    rows,
    fontFamily: font.family,
    fontSize: font.size,
    fontWeight: font.weight as Terminal["options"]["fontWeight"],
    letterSpacing: font.letterSpacing,
    scrollback: 10_000,
    theme: buildTerminalTheme(),
    allowProposedApi: true,
  });
  const dispose = () => {
    const contexts = [...host.querySelectorAll("canvas")].map((canvas) =>
      canvas.getContext("webgl2"),
    );
    term.dispose();
    // Release lab contexts immediately so repeated runs do not depend on WebKit GC.
    for (const gl of contexts)
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    host.remove();
  };
  try {
    term.open(host);
    term.loadAddon(new WebglAddon());
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    term,
    dispose,
  };
}

export function bounded<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
