import { describe, expect, it, vi } from "vitest";
import { createLatestMermaidRenderer } from "./renderQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLatestMermaidRenderer", () => {
  it("publishes only the newest result and coalesces pending work", async () => {
    const first = deferred<string>();
    const latest = deferred<string>();
    const render = vi
      .fn<(source: string) => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(latest.promise);
    const onSuccess = vi.fn();
    const queue = createLatestMermaidRenderer({
      render,
      onSuccess,
      onError: vi.fn(),
    });

    const staleRun = queue.run("flowchart LR\nA-->B");
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    const supersededRun = queue.run("flowchart LR\nB-->C");
    const currentRun = queue.run("flowchart LR\nC-->D");

    expect(render).toHaveBeenCalledOnce();
    first.resolve('<svg id="stale" />');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    latest.resolve('<svg id="current" />');
    await Promise.all([staleRun, supersededRun, currentRun]);

    expect(render).toHaveBeenNthCalledWith(1, "flowchart LR\nA-->B");
    expect(render).toHaveBeenNthCalledWith(2, "flowchart LR\nC-->D");
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith('<svg id="current" />', 3);
  });

  it("does not replace the last valid result with a stale error", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const onError = vi.fn();
    const render = vi
      .fn<(source: string) => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const queue = createLatestMermaidRenderer({
      render,
      onSuccess: vi.fn(),
      onError,
    });

    const staleRun = queue.run("bad");
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    const currentRun = queue.run("good");
    first.reject(new Error("stale parse error"));
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    second.resolve("<svg />");
    await Promise.all([staleRun, currentRun]);

    expect(onError).not.toHaveBeenCalled();
  });
});
