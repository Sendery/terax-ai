import type { EchoTarget } from "@/terminal-lab/lib/echo";

export type LabMode = "bench" | "idle-engine" | "idle-xterm";
export type AutorunConfig = { mode: LabMode; count: number; holdMs: number };
export type LabTarget = EchoTarget & { capture: () => Promise<string> };

export const CAPTURE_LIMIT = 400_000;
export const IDLE_LINES = 10_000;
export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Only a disposable autorun shell receives these commands. Escape Unicode in source.
export const SCRIPTED_SESSION =
  "printf '\\033[2J\\033[H'; ls -la; " +
  "printf '\\033[31mred \\033[32mgreen \\033[34mblue\\033[0m\\n" +
  "wide: \u4e2d\u6587 \u65e5\u672c\u8a9e  emoji: \u{1f680}\\n" +
  "\\033[1mbold\\033[0m \\033[4munderline\\033[0m\\n'; " +
  "printf '\\033[1;1HTERAX_LAB_READY';\r";

export function idleCommand(rows: number): string {
  const lines = IDLE_LINES + rows - 1;
  return `printf '\\033[3J\\033[2J\\033[H'; i=0; while [ "$i" -lt ${lines} ]; do printf 'idle scrollback line %05d\\n' "$i"; i=$((i+1)); done; printf '\\033[2J\\033[HTERAX_IDLE_READY';\r`;
}

export function requireIdleScrollback(
  observed: (number | null)[],
  count: number,
): void {
  if (
    observed.length !== count ||
    observed.some((rows) => rows !== IDLE_LINES)
  ) {
    throw new Error(
      `idle requires ${IDLE_LINES} measured scrollback rows in each of ${count} sessions; observed [${observed.map((rows) => (rows === null ? "unavailable" : String(rows))).join(", ")}]`,
    );
  }
}

export async function scriptedSession(target: LabTarget): Promise<string> {
  const ready = target.waitForCell(0, 0, 84, 15_000);
  await target.write(SCRIPTED_SESSION);
  if ((await ready) === null)
    throw new Error("scripted shell marker not drawn");
  await sleep(300);
  return target.capture();
}

/** Called synchronously in the renderer's after-draw task, before its buffer clears. */
export function captureCanvas(canvas: HTMLCanvasElement): string {
  if (!canvas.width || !canvas.height) throw new Error("empty capture canvas");
  const uri = canvas.toDataURL("image/png");
  if (!uri.startsWith("data:image/png;base64,"))
    throw new Error("PNG capture failed");
  const bytes = atob(uri.slice(uri.indexOf(",") + 1)).length;
  if (bytes >= CAPTURE_LIMIT)
    throw new Error(`capture exceeds ${CAPTURE_LIMIT - 1} bytes`);
  return uri;
}

export function gpuMetadata(
  canvas: HTMLCanvasElement,
): Record<string, unknown> {
  const gl = canvas.getContext("webgl2");
  if (!gl) return { error: "WebGL2 unavailable" };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    vendor: gl.getParameter(gl.VENDOR),
    renderer: gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
    unmaskedRenderer: debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : null,
  };
}
