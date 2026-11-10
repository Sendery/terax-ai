import { afterEach, describe, expect, it, vi } from "vitest";
import { PayloadCompletion } from "@/terminal-lab/lib/completion";

afterEach(() => vi.useRealTimers());

describe("lab payload completion", () => {
  it("allows exit before final data and requires parse plus render", async () => {
    let bytes = 0;
    const barrier = new PayloadCompletion(10, () => bytes);
    let done = false;
    void barrier.done.then(() => {
      done = true;
    });
    barrier.exit(0);
    await Promise.resolve();
    expect(done).toBe(false);
    bytes = 10;
    barrier.rendered();
    barrier.parsed();
    await Promise.resolve();
    expect(done).toBe(false);
    barrier.rendered();
    await barrier.done;
    expect(done).toBe(true);
  });
  it("allows final render before exit", async () => {
    const barrier = new PayloadCompletion(10, () => 10);
    barrier.parsed();
    barrier.rendered();
    barrier.exit(0);
    await expect(barrier.done).resolves.toBeUndefined();
  });
  it("fails missing final data after the bounded post-exit window", async () => {
    vi.useFakeTimers();
    const barrier = new PayloadCompletion(10, () => 8, 100);
    const check = expect(barrier.done).rejects.toThrow("8/10 bytes");
    barrier.exit(0);
    await vi.advanceTimersByTimeAsync(100);
    await check;
  });
  it("fails a nonzero exit without waiting for data", async () => {
    const barrier = new PayloadCompletion(10, () => 0);
    barrier.exit(2);
    await expect(barrier.done).rejects.toThrow("exited 2");
  });
});
