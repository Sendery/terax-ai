import { expect, it, vi } from "vitest";
import {
  labJson,
  awaitLabWrite,
  LAB_REPORT_LIMIT_BYTES,
} from "@/terminal-lab/lib/labReport";
it("preserves a compact report including ordered events within the native byte limit", () => {
  const value = {
    events: Array.from({ length: 100 }, (_, i) => ({
      kind: "drawn",
      seq: i + 1,
      at: i * 17,
    })),
    label: "\u4e2d",
  };
  const json = labJson(value);
  expect(json).toBe(JSON.stringify(value));
  expect(JSON.parse(json)).toEqual(value);
  expect(json.length).toBeLessThan(JSON.stringify(value, null, 2).length);
});
it("uses UTF-8 bytes and refuses oversized or undefined reports before IPC", () => {
  expect(() => labJson(undefined)).toThrow();
  expect(() =>
    labJson({ label: "\u4e2d".repeat(Math.ceil(LAB_REPORT_LIMIT_BYTES / 3)) }),
  ).toThrow("16777216");
});
it("bounds a hung native write and clears the timer for settled writes", async () => {
  vi.useFakeTimers();
  try {
    const pending = awaitLabWrite(new Promise<void>(() => {}));
    const check = expect(pending).rejects.toThrow("write timed out");
    await vi.advanceTimersByTimeAsync(10000);
    await check;
    await expect(awaitLabWrite(Promise.resolve())).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
