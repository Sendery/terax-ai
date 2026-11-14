import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  dispose: vi.fn(),
  callbackThrow: false,
}));
vi.mock("@/modules/terminal/gl/engineSession", () => ({
  labFixture: async () => ({ bytes: 1, path: "/fixture" }),
}));
vi.mock("@/terminal-lab/lib/labXterm", () => ({
  labXterm: () => ({
    term: {
      onRender: () => {},
      write: () => {
        throw new Error("write data discarded, use flow control");
      },
    },
    dispose: state.dispose,
  }),
  bounded: (p: Promise<unknown>) => p,
}));
vi.mock("@/terminal-lab/lib/labPty", () => ({
  openLabPty: async (
    _c: number,
    _r: number,
    handlers: { onData: (b: Uint8Array) => void },
  ) => ({
    close: state.close,
    write: async () => {
      try {
        handlers.onData(new Uint8Array([65]));
      } catch {
        state.callbackThrow = true;
        throw new Error("callback escaped");
      }
    },
  }),
}));
vi.mock("@/terminal-lab/lib/payloadWindow", () => ({
  PayloadWindow: class {
    received = 0;
    push(b: Uint8Array) {
      this.received += b.length;
      return b;
    }
  },
}));
vi.mock("@/terminal-lab/lib/stats", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sampleAnimationFrames: () => ({ stop: () => [] }),
}));
import { runXtermBench } from "@/terminal-lab/lib/xtermBench";
import type { RendererFont } from "@/modules/terminal/gl/gridRenderer";
it("records write overflow without throwing out of Channel and releases the fixture session", async () => {
  const stage = {
    replaceChildren: () => {},
    style: { cssText: "before" },
  } as unknown as HTMLElement;
  const run = await runXtermBench(stage, {} as RendererFont, "ascii", 1, 256);
  expect(state.callbackThrow).toBe(false);
  expect(run.error).toContain("write data discarded");
  expect(state.close).toHaveBeenCalledOnce();
  expect(state.dispose).toHaveBeenCalledOnce();
  expect(stage.style.cssText).toBe("before");
});
