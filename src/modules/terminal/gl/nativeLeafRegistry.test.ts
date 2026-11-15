import { beforeEach, expect, it, vi } from "vitest";
import {
  getNativeLeaf,
  registerNativeLeaf,
  takeNativeLeaf,
  type NativeLeaf,
  subscribeNativeLeaf,
} from "@/modules/terminal/gl/nativeLeafRegistry";
function leaf(id: number): NativeLeaf {
  return {
    id,
    cwd: null,
    shellReady: false,
    commandRunning: false,
    exited: false,
    focused: true,
    tuiReady: false,
    alternateScreen: false,
    getSelection: vi.fn(() => null),
    write: vi.fn(() => true),
    paste: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
    focus: vi.fn(),
    repaint: vi.fn(),
    dispose: vi.fn(async () => {}),
    respawn: vi.fn(async () => {}),
  };
}
beforeEach(() => {
  takeNativeLeaf(71);
});
it("keeps a live native leaf reachable through its real adapter", () => {
  const adapter = leaf(9);
  const unregister = registerNativeLeaf(71, adapter);
  expect(getNativeLeaf(71)).toBe(adapter);
  expect(getNativeLeaf(71)?.write("text")).toBe(true);
  expect(adapter.write).toHaveBeenCalledExactlyOnceWith("text");
  unregister();
  expect(getNativeLeaf(71)).toBeUndefined();
});
it("rejects a duplicate owner instead of replacing a running process", () => {
  const first = leaf(9);
  registerNativeLeaf(71, first);
  expect(() => registerNativeLeaf(71, leaf(10))).toThrow("already registered");
  expect(getNativeLeaf(71)).toBe(first);
});
it("does not let old cleanup remove a replacement", () => {
  const first = leaf(9);
  const cleanup = registerNativeLeaf(71, first);
  expect(takeNativeLeaf(71)).toBe(first);
  const next = leaf(10);
  registerNativeLeaf(71, next);
  cleanup();
  expect(getNativeLeaf(71)).toBe(next);
});

it("notifies early consumers when ownership arrives and ignores stale cleanup", () => {
  const changed = vi.fn();
  const unsubscribe = subscribeNativeLeaf(71, changed);
  const first = leaf(9);
  const cleanup = registerNativeLeaf(71, first);
  expect(changed).toHaveBeenCalledTimes(1);
  takeNativeLeaf(71);
  const next = leaf(10);
  registerNativeLeaf(71, next);
  expect(changed).toHaveBeenCalledTimes(3);
  cleanup();
  expect(changed).toHaveBeenCalledTimes(3);
  unsubscribe();
  takeNativeLeaf(71);
  expect(changed).toHaveBeenCalledTimes(3);
});
