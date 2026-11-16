import { afterEach, expect, it, vi } from "vitest";
import {
  prepareFrameCapture,
  registerFrameCaptureProvider,
} from "@/modules/capture/lib/frameCapture";
afterEach(() => vi.unstubAllGlobals());
it("retires a prepared frame lease on resize, hiding, owner replacement or disposal", async () => {
  let width = 500,
    visibility = "visible";
  const root = {
    isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height: 350 }),
  } as unknown as HTMLIFrameElement;
  vi.stubGlobal("window", { getComputedStyle: () => ({ visibility }) });
  const scope = { signal: new AbortController().signal, current: () => true };
  const register = () =>
    registerFrameCaptureProvider(
      root,
      async () => "data:image/png;base64,aGVsbG8=",
    );
  const unregister = register();
  const lease = await prepareFrameCapture(root, scope);
  expect(lease.current()).toBe(true);
  width++;
  expect(lease.current()).toBe(false);
  width--;
  visibility = "hidden";
  expect(lease.current()).toBe(false);
  visibility = "visible";
  const replace = register();
  unregister();
  expect(lease.current()).toBe(false);
  lease.dispose();
  const next = await prepareFrameCapture(root, scope);
  expect(next.current()).toBe(true);
  next.dispose();
  expect(next.current()).toBe(false);
  replace();
});
it("refuses missing providers and releases ownership after cancellation of pending preparation", async () => {
  const root = {
    isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 350 }),
  } as unknown as HTMLIFrameElement;
  vi.stubGlobal("window", {
    getComputedStyle: () => ({ visibility: "visible" }),
  });
  const controller = new AbortController();
  const scope = { signal: controller.signal, current: () => true };
  await expect(prepareFrameCapture(root, scope)).rejects.toThrow("unavailable");
  let finish = (_png: string) => {};
  const stop = registerFrameCaptureProvider(
    root,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = prepareFrameCapture(root, scope);
  const rejected = expect(pending).rejects.toThrow("cancelled");
  controller.abort();
  await rejected;
  finish("data:image/png;base64,aGVsbG8=");
  stop();
  const cleanup = registerFrameCaptureProvider(
    root,
    async () => "data:image/png;base64,aGVsbG8=",
  );
  const lease = await prepareFrameCapture(root, {
    signal: new AbortController().signal,
    current: () => true,
  });
  lease.dispose();
  cleanup();
});
