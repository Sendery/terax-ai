import { expect, it, vi } from "vitest";
import { TerminalRetirement } from "@/modules/terminal/lib/terminalRetirement";
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it("does not open a replacement until prior close actually completes", async () => {
  const chain = new TerminalRetirement();
  const closing = deferred();
  const retired = chain.track(closing.promise);
  const open = vi.fn(async () => "new pty");
  const replacement = chain.beforeOpen().then(open);
  await Promise.resolve();
  expect(open).not.toHaveBeenCalled();
  closing.resolve();
  await retired;
  await expect(replacement).resolves.toBe("new pty");
  expect(open).toHaveBeenCalledOnce();
});
it("does not open after a close failure or forget that failure on later cleanup", async () => {
  const chain = new TerminalRetirement();
  const closing = deferred();
  const retired = chain.track(closing.promise);
  const failed = Promise.allSettled([retired]);
  const open = vi.fn(async () => "unexpected pty");
  const replacement = chain.beforeOpen().then(open);
  const result = Promise.allSettled([replacement]);
  const error = new Error("close rejected");
  closing.reject(error);
  await failed;
  expect((await result)[0]).toMatchObject({
    status: "rejected",
    reason: error,
  });
  await expect(chain.track(Promise.resolve())).rejects.toBe(error);
  expect(open).not.toHaveBeenCalled();
});
it("captures the predecessor before this owner's own cleanup is tracked", async () => {
  const chain = new TerminalRetirement();
  const prerequisite = chain.beforeOpen();
  const closing = deferred();
  const retired = chain.track(closing.promise);
  const open = vi.fn(async () => "first pty");
  await expect(prerequisite.then(open)).resolves.toBe("first pty");
  closing.resolve();
  await retired;
});
