import { expect, it, vi } from "vitest";
import {
  createNativeSearch,
  type NativeSearchCommand,
} from "@/modules/terminal/gl/nativeSearch";

it("serializes navigation and clear while coalescing queued incremental text", async () => {
  let release!: (value: boolean) => void;
  const send = vi
    .fn<(command: NativeSearchCommand) => Promise<boolean>>()
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(true);
  const search = createNativeSearch(send);
  const first = search.findNext("n", { incremental: true });
  const replaced = search.findNext("ne", { incremental: true });
  const latest = search.findNext("needle", { incremental: true });
  const next = search.findNext("needle");
  const previous = search.findPrevious("needle");
  const clear = search.clearDecorations();
  expect(send).toHaveBeenCalledTimes(1);
  await expect(replaced).resolves.toBe(false);
  release(true);
  await Promise.all([first, latest, next, previous, clear]);
  expect(send.mock.calls.map(([command]) => command)).toEqual([
    { kind: "find", query: "n", forward: true, incremental: true },
    { kind: "find", query: "needle", forward: true, incremental: true },
    { kind: "find", query: "needle", forward: true, incremental: false },
    { kind: "find", query: "needle", forward: false, incremental: false },
    { kind: "clear" },
  ]);
});

it("recovers after an IPC failure and does not let clear overtake it", async () => {
  const send = vi
    .fn<(command: NativeSearchCommand) => Promise<boolean>>()
    .mockRejectedValueOnce(new Error("closed"))
    .mockResolvedValue(false);
  const search = createNativeSearch(send);
  await expect(search.findNext("needle")).rejects.toThrow("closed");
  await expect(search.clearDecorations()).resolves.toBeUndefined();
  expect(send.mock.calls[1][0]).toEqual({ kind: "clear" });
});

it("rejects malformed and oversized queries before IPC", async () => {
  const send = vi.fn(async () => false);
  const search = createNativeSearch(send);
  await expect(search.findNext("bad\nquery")).rejects.toThrow("4096");
  await expect(search.findNext("中".repeat(1400))).rejects.toThrow("4096");
  expect(send).not.toHaveBeenCalled();
});
