import { expect, it, vi } from "vitest";
import { createTerminalSubmission } from "@/modules/terminal/lib/sessionSubmission";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it.each(["native", "legacy"])(
  "rejects a replaced %s owner even when the same leaf becomes ready",
  async () => {
    const readiness = deferred();
    const original = {};
    let owner = original;
    const submit = vi.fn(async () => {});
    const captured = createTerminalSubmission({
      current: () => owner === original,
      ready: () => true,
      wait: () => readiness.promise,
      submit,
    });
    const result = captured.submitWhenReady("resume saved conversation", 15000);
    owner = {};
    readiness.resolve();
    expect(await result).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  },
);
it("never interprets a readiness timeout as a prompt", async () => {
  const submit = vi.fn(async () => {});
  const captured = createTerminalSubmission({
    current: () => true,
    ready: () => false,
    wait: async () => {},
    submit,
  });
  expect(await captured.submitWhenReady("resume", 1)).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
it("submits only once and waits for the actual write", async () => {
  const readiness = deferred(),
    write = deferred();
  const submit = vi.fn(() => write.promise);
  const captured = createTerminalSubmission({
    current: () => true,
    ready: () => true,
    wait: () => readiness.promise,
    submit,
  });
  let settled = false;
  const first = captured.submitWhenReady("resume", 15000).then((result) => {
    settled = true;
    return result;
  });
  const duplicate = captured.submitWhenReady("resume", 15000);
  expect(await duplicate).toBe(false);
  readiness.resolve();
  await Promise.resolve();
  expect(submit).toHaveBeenCalledExactlyOnceWith(
    "resume",
    expect.any(Function),
  );
  expect(settled).toBe(false);
  write.resolve();
  expect(await first).toBe(true);
});
it("contains a rejected submission and cannot repeat the failed attempt", async () => {
  const submit = vi.fn(async () => {
    throw new Error("closed");
  });
  const captured = createTerminalSubmission({
    current: () => true,
    ready: () => true,
    wait: async () => {},
    submit,
  });
  expect(await captured.submitWhenReady("resume", 1)).toBe(false);
  expect(await captured.submitWhenReady("resume", 1)).toBe(false);
  expect(submit).toHaveBeenCalledOnce();
});
it("revalidates caller privacy after readiness", async () => {
  const readiness = deferred();
  let publicTarget = true;
  const submit = vi.fn(async () => {});
  const captured = createTerminalSubmission({
    current: () => true,
    ready: () => true,
    wait: () => readiness.promise,
    submit,
  });
  const result = captured.submitWhenReady("resume", 15000, () => publicTarget);
  publicTarget = false;
  readiness.resolve();
  expect(await result).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
it("does not confirm a late write after its owner was retired", async () => {
  let current = true;
  const write = deferred();
  const captured = createTerminalSubmission({
    current: () => current,
    ready: () => true,
    wait: async () => {},
    submit: () => write.promise,
  });
  const result = captured.submitWhenReady("resume", 15000);
  await Promise.resolve();
  current = false;
  write.resolve();
  expect(await result).toBe(false);
});
