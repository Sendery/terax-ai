import { describe, expect, it, vi } from "vitest";
import { SegmentQueue } from "./session";

const ENDPOINT = { port: 51_000, token: "t" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function pcm(n: number): Float32Array {
  return new Float32Array(n);
}

describe("SegmentQueue", () => {
  it("transcribes live segments one at a time and keeps their order", async () => {
    const calls: number[] = [];
    const gates = [deferred<string>(), deferred<string>()];
    const queue = new SegmentQueue(
      {
        resolve: async () => ENDPOINT,
        transcribe: async (_endpoint, audio) => {
          calls.push(audio.length);
          return gates[calls.length - 1].promise;
        },
      },
      true,
    );
    queue.push(pcm(1));
    queue.push(pcm(2));
    await Promise.resolve();
    await Promise.resolve();
    // The second segment waits for the first.
    expect(calls).toEqual([1]);
    gates[0].resolve("primero");
    await vi.waitFor(() => expect(calls).toEqual([1, 2]));
    gates[1].resolve("segundo");
    await expect(queue.finish()).resolves.toEqual(["primero", "segundo"]);
  });

  it("holds segments until finish when live segments are off", async () => {
    const transcribe = vi.fn(async (_e: unknown, audio: Float32Array) => `n${audio.length}`);
    const queue = new SegmentQueue({ resolve: async () => ENDPOINT, transcribe }, false);
    queue.push(pcm(3));
    queue.push(pcm(4));
    await Promise.resolve();
    expect(transcribe).not.toHaveBeenCalled();
    await expect(queue.finish()).resolves.toEqual(["n3", "n4"]);
  });

  it("starts the engine once, ahead of the first segment", async () => {
    const resolve = vi.fn(async () => ENDPOINT);
    const queue = new SegmentQueue({ resolve, transcribe: async () => "x" }, true);
    void queue.prepare();
    queue.push(pcm(1));
    queue.push(pcm(1));
    await queue.finish();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("surfaces the first failure and skips the rest", async () => {
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new Error("engine died"))
      .mockResolvedValue("never");
    const queue = new SegmentQueue({ resolve: async () => ENDPOINT, transcribe }, true);
    queue.push(pcm(1));
    queue.push(pcm(1));
    await expect(queue.finish()).rejects.toThrow("engine died");
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("reports an engine that could not start when a segment needs it", async () => {
    const queue = new SegmentQueue(
      {
        resolve: async () => {
          throw new Error("Install the dictation model in Settings, Dictation.");
        },
        transcribe: async () => "x",
      },
      true,
    );
    void queue.prepare();
    queue.push(pcm(1));
    await expect(queue.finish()).rejects.toThrow(/Install the dictation model/);
  });

  it("drops everything once cancelled and aborts the signal", async () => {
    const transcribe = vi.fn(async () => "x");
    const queue = new SegmentQueue({ resolve: async () => ENDPOINT, transcribe }, true);
    queue.cancel();
    queue.push(pcm(1));
    await expect(queue.finish()).resolves.toEqual([]);
    expect(queue.signal.aborted).toBe(true);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
