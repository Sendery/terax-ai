import { afterEach, expect, it, vi } from "vitest";
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), rasterize: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("@/modules/capture/lib/rasterize", () => ({
  rasterizeElement: ipc.rasterize,
}));
import { captureSurface } from "@/modules/capture/lib/capture";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("rejects an inactive native terminal capture before rasterizing or persisting a blank pane", async () => {
  const element = { querySelector: () => ({}) };
  vi.stubGlobal("document", { querySelector: () => element });
  await expect(
    captureSurface({ target: "pane", tabId: 2 }, [{ id: 1 }, { id: 2 }], 1),
  ).rejects.toThrow("Focus this terminal tab before capturing it.");
  expect(ipc.rasterize).not.toHaveBeenCalled();
  expect(ipc.invoke).not.toHaveBeenCalled();
});

it.each(["pane", "active-pane"] as const)(
  "rejects a native %s hidden during capture preparation",
  async (target) => {
    const native = { style: { visibility: "visible" } };
    const element = { isConnected: true, querySelector: () => native };
    let frames = 0;
    vi.stubGlobal("document", { querySelector: () => element });
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      getComputedStyle: () => native.style,
    });
    vi.stubGlobal(
      "CustomEvent",
      class {
        constructor(
          public type: string,
          public options: unknown,
        ) {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      if (++frames === 2) native.style.visibility = "hidden";
      callback();
      return frames;
    });
    await expect(
      captureSurface(
        target === "pane" ? { target, tabId: 1 } : { target },
        [{ id: 1 }, { id: 2 }],
        1,
      ),
    ).rejects.toThrow("Focus this terminal tab before capturing it.");
    expect(ipc.rasterize).not.toHaveBeenCalled();
    expect(ipc.invoke).not.toHaveBeenCalled();
  },
);
