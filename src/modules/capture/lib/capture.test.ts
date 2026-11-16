import { afterEach, expect, it, vi } from "vitest";
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), rasterize: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("@/modules/capture/lib/rasterize", async (original) => ({
  ...(await original<typeof import("@/modules/capture/lib/rasterize")>()),
  rasterizeElement: ipc.rasterize,
}));
import {
  captureSurface,
  CAPTURE_TIMEOUT_MS,
} from "@/modules/capture/lib/capture";
import {
  registerNativeCaptureProvider,
  type NativeCaptureLease,
} from "@/modules/capture/lib/captureLease";
const cleanup: (() => void)[] = [];
function fixture(id = 2, active = 1) {
  let tabs: { id: number; private?: boolean }[] = [{ id: 1 }, { id: 2 }];
  const style = { visibility: id === active ? "visible" : "hidden" };
  const native = { isConnected: true, style } as unknown as HTMLElement;
  const bounds = { left: 0, top: 0, width: 112, height: 92 };
  const element = {
    isConnected: true,
    querySelector: () => native,
    querySelectorAll: (selector: string) =>
      selector.startsWith("iframe") ? [] : [native],
    hasAttribute: () => false,
    getBoundingClientRect: () => bounds,
  } as unknown as HTMLElement;
  vi.stubGlobal("document", {
    body: element,
    querySelector: (selector: string) =>
      selector.includes("data-capture-tab-id") && !selector.includes(`="${id}"`)
        ? null
        : element,
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    getComputedStyle: () => style,
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
  let frames = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return ++frames;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const image = {
    blob: new Blob([new Uint8Array([1, 2, 3])]),
    width: 112,
    height: 92,
  };
  ipc.rasterize.mockResolvedValue(image);
  ipc.invoke.mockResolvedValue({ path: "/public/capture.png", bytes: 3 });
  let live = true;
  const lease = {
    root: native,
    canvas: {} as HTMLCanvasElement,
    snapshot: "data:image/png;base64,public",
    excluded: [],
    current: () => live,
    dispose: vi.fn(),
  } satisfies NativeCaptureLease;
  const provider = vi.fn(async () => lease);
  return {
    native,
    element,
    image,
    lease,
    provider,
    style,
    bounds,
    context: () => ({ tabs, activeTabId: active }),
    private: () => {
      tabs = [{ id: 1 }, { id: 2, private: true }];
    },
    stale: () => {
      live = false;
    },
    register: () => {
      cleanup.push(registerNativeCaptureProvider(native, provider));
    },
  };
}
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});
it("rejects an inactive native pane without a provider before rasterizing or persisting blank pixels", async () => {
  const f = fixture();
  await expect(
    captureSurface({ target: "pane", tabId: 2 }, f.context),
  ).rejects.toThrow("unavailable");
  expect(ipc.rasterize).not.toHaveBeenCalled();
  expect(ipc.invoke).not.toHaveBeenCalled();
});
it("captures only an explicitly requested inactive public native pane without changing the active tab", async () => {
  const f = fixture();
  f.register();
  const result = await captureSurface({ target: "pane", tabId: 2 }, f.context);
  expect(result).toMatchObject({
    target: "pane",
    tabId: 2,
    path: "/public/capture.png",
    width: 112,
    height: 92,
  });
  expect(f.context().activeTabId).toBe(1);
  expect(f.provider).toHaveBeenCalledOnce();
  expect(ipc.rasterize.mock.calls[0][1].leases).toHaveLength(1);
  expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith(
    "capture_persist",
    new Uint8Array([1, 2, 3]),
  );
  expect(f.lease.dispose).toHaveBeenCalledOnce();
});
it("does not opt hidden native panes into a whole-window capture", async () => {
  const f = fixture();
  f.register();
  await captureSurface({ target: "window" }, f.context);
  expect(f.provider).not.toHaveBeenCalled();
  expect(ipc.rasterize.mock.calls[0][1].leases).toEqual([]);
});
it.each(["pane", "active-pane"] as const)(
  "rejects a native %s hidden during capture preparation",
  async (target) => {
    const f = fixture(1, 1);
    let frames = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      if (++frames === 2) f.style.visibility = "hidden";
      callback();
      return frames;
    });
    await expect(
      captureSurface(
        target === "pane" ? { target, tabId: 1 } : { target },
        f.context,
      ),
    ).rejects.toThrow("Focus this terminal tab before capturing it.");
    expect(ipc.rasterize).not.toHaveBeenCalled();
    expect(ipc.invoke).not.toHaveBeenCalled();
  },
);
it.each(["privacy", "owner", "disconnect", "geometry"] as const)(
  "revalidates %s after rasterization and never persists an obsolete capture",
  async (kind) => {
    const f = fixture();
    f.register();
    let finish = (_image: typeof f.image) => {};
    ipc.rasterize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = captureSurface({ target: "pane", tabId: 2 }, f.context);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(ipc.rasterize).toHaveBeenCalledOnce());
    if (kind === "privacy") f.private();
    if (kind === "owner") f.stale();
    if (kind === "disconnect") Object.assign(f.element, { isConnected: false });
    if (kind === "geometry") f.bounds.width++;
    finish(f.image);
    await rejected;
    expect(ipc.invoke).not.toHaveBeenCalled();
    expect(f.lease.dispose).toHaveBeenCalledOnce();
  },
);
it("uses one deadline to abort preparation and cleans a late provider result", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let finish = (_lease: NativeCaptureLease) => {};
  cleanup.push(
    registerNativeCaptureProvider(
      f.native,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const pending = captureSurface({ target: "pane", tabId: 2 }, f.context);
  const rejected = expect(pending).rejects.toThrow("deadline");
  await vi.advanceTimersByTimeAsync(CAPTURE_TIMEOUT_MS + 1);
  await rejected;
  finish(f.lease);
  await Promise.resolve();
  expect(f.lease.dispose).toHaveBeenCalledOnce();
  expect(ipc.rasterize).not.toHaveBeenCalled();
  expect(ipc.invoke).not.toHaveBeenCalled();
});
it("checks live privacy again after PNG byte conversion immediately before persistence", async () => {
  const f = fixture();
  f.register();
  ipc.rasterize.mockResolvedValue({
    ...f.image,
    blob: {
      arrayBuffer: async () => {
        f.private();
        return new Uint8Array([1]).buffer;
      },
    },
  });
  await expect(
    captureSurface({ target: "pane", tabId: 2 }, f.context),
  ).rejects.toThrow();
  expect(ipc.invoke).not.toHaveBeenCalled();
  expect(f.lease.dispose).toHaveBeenCalledOnce();
});

it.each(["privacy", "frame-retired"] as const)(
  "refuses persistence when a visible graph loses %s after rasterization",
  async (kind) => {
    const f = fixture(1, 1);
    const frame = {
      isConnected: true,
      getBoundingClientRect: () => f.bounds,
    } as unknown as HTMLIFrameElement;
    Object.assign(f.element, {
      querySelectorAll: (selector: string) =>
        selector.startsWith("iframe") ? [frame] : [],
    });
    const { registerFrameCaptureProvider } = await import(
      "@/modules/capture/lib/frameCapture"
    );
    const stop = registerFrameCaptureProvider(
      frame,
      async () => "data:image/png;base64,aGVsbG8=",
    );
    cleanup.push(stop);
    ipc.rasterize.mockImplementation(async () => {
      if (kind === "privacy") f.private();
      else stop();
      return f.image;
    });
    await expect(
      captureSurface({ target: "window" }, f.context),
    ).rejects.toThrow();
    expect(ipc.rasterize.mock.calls[0][1].frameLeases).toHaveLength(1);
    expect(ipc.invoke).not.toHaveBeenCalled();
  },
);
