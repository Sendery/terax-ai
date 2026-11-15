import {
  NativeClipboardRelay,
  nativeClipboardText,
} from "@/modules/terminal/gl/nativeClipboard";
import { describe, expect, it, vi } from "vitest";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("bounded native clipboard delivery", () => {
  it("defers an early signal until its session is open", async () => {
    let current = false;
    const take = vi.fn(async () => "known text"),
      write = vi.fn(async () => {});
    const relay = new NativeClipboardRelay({
      current: () => current,
      take,
      write,
    });
    relay.notify();
    relay.notify();
    expect(take).not.toHaveBeenCalled();
    current = true;
    relay.resume();
    await tick();
    expect(take).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledExactlyOnceWith("known text");
  });
  it("coalesces signals while a clipboard write is pending", async () => {
    let finish = () => {};
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const take = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValue("latest");
    const write = vi
      .fn()
      .mockImplementationOnce(() => blocked)
      .mockResolvedValue(undefined);
    const relay = new NativeClipboardRelay({
      current: () => true,
      take,
      write,
    });
    relay.notify();
    await tick();
    for (let i = 0; i < 10000; i++) relay.notify();
    expect(take).toHaveBeenCalledOnce();
    finish();
    await tick();
    expect(take).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.map((call) => call[0])).toEqual([
      "first",
      "latest",
    ]);
  });
  it.each(["close", "unavailable"])(
    "rejects a delayed read after %s",
    async (mode) => {
      let finish = (value: string) => {
        void value;
      };
      const pending = new Promise<string>((resolve) => {
        finish = resolve;
      });
      let current = true;
      const write = vi.fn(async () => {});
      const relay = new NativeClipboardRelay({
        current: () => current,
        take: () => pending,
        write,
      });
      relay.notify();
      if (mode === "close") relay.close();
      else current = false;
      finish("stale");
      await tick();
      expect(write).not.toHaveBeenCalled();
    },
  );
  it("contains write errors and continues with a later valid write", async () => {
    const take = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValue("next");
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(undefined);
    const relay = new NativeClipboardRelay({
      current: () => true,
      take,
      write,
    });
    relay.notify();
    await tick();
    relay.notify();
    await tick();
    expect(write.mock.calls.map((call) => call[0])).toEqual(["first", "next"]);
  });
  it("validates the bounded text boundary while preserving explicit empty text and NUL", () => {
    expect(nativeClipboardText(null)).toBe(null);
    expect(nativeClipboardText("")).toBe("");
    expect(nativeClipboardText("a\0b")).toBe("a\0b");
    expect(nativeClipboardText("a".repeat(1024 * 1024))).toHaveLength(
      1024 * 1024,
    );
    for (const value of [
      undefined,
      {},
      ["text"],
      "a".repeat(1024 * 1024 + 1),
      "\u00e9".repeat(512 * 1024 + 1),
    ])
      expect(() => nativeClipboardText(value)).toThrow(
        "Invalid terminal clipboard write",
      );
  });
});
