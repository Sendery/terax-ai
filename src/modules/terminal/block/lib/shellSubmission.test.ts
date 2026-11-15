import { expect, it, vi } from "vitest";
import { ShellSubmission } from "@/modules/terminal/block/lib/shellSubmission";

it("clears a synchronous accepted draft once and preserves a rejected draft", () => {
  const submission = new ShellSubmission();
  const accepted = vi.fn();
  const failed = vi.fn();
  submission.run(() => {}, accepted, failed);
  expect(accepted).toHaveBeenCalledOnce();
  submission.run(
    () => {
      throw new Error("not ready");
    },
    accepted,
    failed,
  );
  expect(accepted).toHaveBeenCalledOnce();
  expect(failed).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ message: "not ready" }),
  );
});
it("does not clear until native submission is accepted", async () => {
  const submission = new ShellSubmission();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const accepted = vi.fn();
  submission.run(() => pending, accepted, vi.fn());
  expect(accepted).not.toHaveBeenCalled();
  finish();
  await pending;
  await Promise.resolve();
  expect(accepted).toHaveBeenCalledOnce();
});
it("retains a rejected async draft and reports the failure", async () => {
  const submission = new ShellSubmission();
  const accepted = vi.fn();
  const failed = vi.fn();
  const error = new Error("native queue full");
  const pending = Promise.reject(error);
  submission.run(() => pending, accepted, failed);
  await Promise.resolve();
  await Promise.resolve();
  expect(accepted).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledExactlyOnceWith(error);
});
it("never clears a replacement leaf's identical draft after a delayed acceptance", async () => {
  const submission = new ShellSubmission();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const accepted = vi.fn();
  const failed = vi.fn();
  submission.run(() => pending, accepted, failed);
  submission.invalidate();
  finish();
  await pending;
  await Promise.resolve();
  expect(accepted).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});
it("ignores a late error after retarget or disposal", async () => {
  const submission = new ShellSubmission();
  let reject!: (error: unknown) => void;
  const pending = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  const failed = vi.fn();
  submission.run(() => pending, vi.fn(), failed);
  submission.invalidate();
  reject(new Error("old process"));
  await Promise.resolve();
  await Promise.resolve();
  expect(failed).not.toHaveBeenCalled();
});
