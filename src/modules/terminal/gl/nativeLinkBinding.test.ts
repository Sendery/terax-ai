import { afterEach, expect, it, vi } from "vitest";
import {
  bindNativeLinks,
  type NativeLinkBinding,
} from "@/modules/terminal/gl/nativeLinkBinding";
import type { EngineSession } from "@/modules/terminal/gl/engineSession";
import type { GridRenderer } from "@/modules/terminal/gl/gridRenderer";
vi.mock("@/lib/external-link", () => ({
  openExternalUrl: vi.fn(async () => {}),
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
  workspaceScopeKey: () => "local",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ kind: "file" })),
}));
afterEach(() => vi.unstubAllGlobals());
it("restores link hit testing after geometry changes without a new PTY frame", async () => {
  const queue: FrameRequestCallback[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const node = () => ({
    style: {} as Record<string, string>,
    dataset: {},
    title: "",
    setAttribute: vi.fn(),
    append: vi.fn(),
    replaceChildren: vi.fn(),
    remove: vi.fn(),
  });
  const box = { left: 0, top: 0, right: 92, bottom: 44, width: 92, height: 44 };
  const host = {
    ...node(),
    isConnected: true,
    getBoundingClientRect: () => ({ ...box }),
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      listeners.set(name, handler),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("document", { createElement: node, hasFocus: () => true });
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const lookup = vi.fn(async (_seq: number, _col: number, _row: number) => ({
    seq: 1,
    cols: 10,
    viewportRows: 2,
    text: "link",
    offset: 1,
    startClipped: false,
    endClipped: false,
    rows: [
      {
        row: 0,
        startCol: 0,
        cells: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
        ],
      },
    ],
    osc8: {
      uri: "https://example.test",
      ranges: [{ row: 0, start: 0, end: 4 }],
    },
  }));
  const session = {
    id: 9,
    pane: {},
    drawnSeq: 1,
    drawnGrid: { seq: 1, cols: 10, rows: 2 },
    linkContext: lookup,
  };
  let binding!: NativeLinkBinding;
  const renderer = {
    cellSize: { width: 8, height: 16 },
    markUndrawn: vi.fn(() => queue.push(() => binding.onDrawn())),
  };
  binding = bindNativeLinks(
    session as unknown as EngineSession,
    renderer as unknown as GridRenderer,
    host as unknown as HTMLElement,
    {
      available: () => true,
      active: () => true,
      cwd: () => "/repo",
      home: () => "/home/test",
      foreground: () => "#ffffff",
      openFile: vi.fn(),
      focus: vi.fn(),
    },
  );
  const flush = () => {
    while (queue.length) queue.shift()?.(performance.now());
  };
  binding.updateLayout();
  expect(renderer.markUndrawn).toHaveBeenCalledOnce();
  flush();
  listeners.get("pointermove")?.({ clientX: 18, clientY: 14, pointerId: 1 });
  flush();
  await vi.waitFor(() => expect(host.style.cursor).toBe("pointer"));
  box.left = 20;
  box.right = 112;
  binding.updateLayout();
  expect(renderer.markUndrawn).toHaveBeenCalledTimes(2);
  listeners.get("pointermove")?.({ clientX: 38, clientY: 14, pointerId: 1 });
  flush();
  await vi.waitFor(() => expect(host.style.cursor).toBe("pointer"));
  expect(lookup.mock.calls.every((call) => call[0] === 1)).toBe(true);
  binding.dispose();
});
