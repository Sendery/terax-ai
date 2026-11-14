import { afterEach, expect, it, vi } from "vitest";
import { waitForClaudeTuiReady } from "@/modules/ai/lib/claudeReadiness";
import { readTerminalContext } from "@/modules/ai/lib/terminalContext";

afterEach(() => vi.useRealTimers());

it("keeps polling a valid empty native screen until the Claude banner appears", async () => {
  vi.useFakeTimers();
  let buffer = "";
  const handle = { getBuffer: vi.fn(async () => buffer) };
  const target = () => ({ tabId: 1, leafId: 2, handle, private: false });
  const result = waitForClaudeTuiReady(() => readTerminalContext(target, 120));
  await vi.advanceTimersByTimeAsync(0);
  expect(handle.getBuffer).toHaveBeenCalledTimes(1);
  buffer = "? for shortcuts";
  await vi.advanceTimersByTimeAsync(120);
  await expect(result).resolves.toBe("ready");
  expect(handle.getBuffer).toHaveBeenCalledTimes(2);
});

it("reports gone when the native panel is unavailable", async () => {
  await expect(waitForClaudeTuiReady(async () => null)).resolves.toBe("gone");
});

it("times out instead of treating a permanently blank screen as gone or ready", async () => {
  vi.useFakeTimers();
  const result = waitForClaudeTuiReady(async () => "", 240);
  await vi.advanceTimersByTimeAsync(240);
  await expect(result).resolves.toBe("timeout");
});
