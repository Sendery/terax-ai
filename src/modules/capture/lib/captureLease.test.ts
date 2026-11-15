import { expect, it, vi } from "vitest";
import {
  duringCapture,
  prepareNativeCapture,
  registerNativeCaptureProvider,
  type NativeCaptureLease,
} from "@/modules/capture/lib/captureLease";

function fixture() {
  const root = { isConnected: true } as HTMLElement;
  const controller = new AbortController();
  let valid = true;
  const scope = { signal: controller.signal, current: () => valid };
  const lease = {
    root,
    canvas: {} as HTMLCanvasElement,
    snapshot: "data:image/png;base64,public",
    excluded: [],
    current: () => true,
    dispose: vi.fn(),
  } satisfies NativeCaptureLease;
  return {
    root,
    controller,
    scope,
    lease,
    invalidate: () => {
      valid = false;
    },
  };
}
it("holds a scoped provider lease until idempotent disposal and rejects concurrent capture", async () => {
  const f = fixture();
  const unregister = registerNativeCaptureProvider(f.root, async () => f.lease);
  const result = await prepareNativeCapture(f.root, f.scope);
  await expect(prepareNativeCapture(f.root, f.scope)).rejects.toThrow(
    "already",
  );
  expect(result.current()).toBe(true);
  result.dispose();
  result.dispose();
  expect(f.lease.dispose).toHaveBeenCalledOnce();
  const next = await prepareNativeCapture(f.root, f.scope);
  next.dispose();
  unregister();
});
it("invalidates a provider lease when its view is detached or re-registered", async () => {
  const f = fixture();
  const old = registerNativeCaptureProvider(f.root, async () => f.lease);
  const result = await prepareNativeCapture(f.root, f.scope);
  const next = registerNativeCaptureProvider(f.root, async () => f.lease);
  old();
  expect(result.current()).toBe(false);
  result.dispose();
  const replacement = await prepareNativeCapture(f.root, f.scope);
  Object.assign(f.root, { isConnected: false });
  expect(replacement.current()).toBe(false);
  replacement.dispose();
  next();
});
it("disposes a provider result if privacy is invalidated during preparation", async () => {
  const f = fixture();
  let finish = (_lease: NativeCaptureLease) => {};
  const pending = new Promise<NativeCaptureLease>((resolve) => {
    finish = resolve;
  });
  const unregister = registerNativeCaptureProvider(f.root, () => pending);
  const result = prepareNativeCapture(f.root, f.scope);
  const rejected = expect(result).rejects.toThrow("available");
  f.invalidate();
  finish(f.lease);
  await rejected;
  expect(f.lease.dispose).toHaveBeenCalledOnce();
  unregister();
});
it("aborts promptly and disposes a late resource without retaining the provider lock", async () => {
  const f = fixture();
  let finish = (_lease: NativeCaptureLease) => {};
  const pending = new Promise<NativeCaptureLease>((resolve) => {
    finish = resolve;
  });
  const unregister = registerNativeCaptureProvider(f.root, () => pending);
  const result = prepareNativeCapture(f.root, f.scope);
  const rejected = expect(result).rejects.toThrow("cancel");
  f.controller.abort();
  await rejected;
  finish(f.lease);
  await Promise.resolve();
  expect(f.lease.dispose).toHaveBeenCalledOnce();
  unregister();
});
it("refuses missing providers rather than substituting a blank native canvas", async () => {
  const f = fixture();
  await expect(prepareNativeCapture(f.root, f.scope)).rejects.toThrow(
    "unavailable",
  );
});
it("checks the live scope after ordinary async work", async () => {
  const f = fixture();
  const value = duringCapture(Promise.resolve("public"), f.scope);
  f.invalidate();
  await expect(value).rejects.toThrow("available");
});
