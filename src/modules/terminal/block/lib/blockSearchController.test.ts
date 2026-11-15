import { expect, it, vi } from "vitest";
import {
  BlockSearchController,
  readAvailableBlockOutput,
} from "./blockSearchController";
const match = { line: 1, col: 2, len: 3, native: { version: 1, index: 0 } };
it("coalesces searches, discards old results and reveals only the current result", async () => {
  let resolve!: (value: (typeof match)[]) => void;
  const search = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue([match]);
  const reveal = vi.fn(async () => true);
  const changed = vi.fn();
  const model = new BlockSearchController({
    searchBlock: search,
    revealMatch: reveal,
    clearSearch: vi.fn(),
    onChange: changed,
  });
  model.find("old");
  model.find("middle");
  model.find("new");
  expect(search).toHaveBeenCalledTimes(1);
  expect(model.state.pending).toBe(true);
  resolve([{ ...match, line: 99 }]);
  await vi.waitFor(() => expect(model.state.pending).toBe(false));
  expect(search.mock.calls.map((args) => args[0])).toEqual(["old", "new"]);
  expect(reveal).toHaveBeenCalledExactlyOnceWith(match);
  expect(model.state.matches).toEqual([match]);
  await model.dispose();
});
it("clears the actual source and never reveals or publishes a result after disposal", async () => {
  let resolve!: (value: (typeof match)[]) => void;
  const search = vi.fn(
    () =>
      new Promise<(typeof match)[]>((r) => {
        resolve = r;
      }),
  );
  const reveal = vi.fn();
  const clear = vi.fn(async () => {});
  const changed = vi.fn();
  const model = new BlockSearchController({
    searchBlock: search,
    revealMatch: reveal,
    clearSearch: clear,
    onChange: changed,
  });
  model.find("old");
  await model.dispose();
  const count = changed.mock.calls.length;
  resolve([match]);
  await Promise.resolve();
  await Promise.resolve();
  expect(changed).toHaveBeenCalledTimes(count);
  expect(reveal).not.toHaveBeenCalled();
  expect(clear).toHaveBeenCalledOnce();
});
it("navigates by native match token and reports unavailable results", async () => {
  const second = { ...match, native: { version: 1, index: 1 }, line: 2 };
  const reveal = vi.fn().mockResolvedValue(true);
  const model = new BlockSearchController({
    searchBlock: async () => [match, second],
    revealMatch: reveal,
    clearSearch: vi.fn(),
    onChange: vi.fn(),
  });
  model.find("x");
  await vi.waitFor(() => expect(model.state.pending).toBe(false));
  await model.navigate(-1);
  expect(reveal).toHaveBeenLastCalledWith(second);
  expect(model.state.index).toBe(1);
  reveal.mockResolvedValue(false);
  await model.navigate(1);
  expect(model.state.error).toContain("available");
  expect(model.state.matches).toEqual([]);
  await model.dispose();
});
it("surfaces search failures without stale matches or unhandled promises", async () => {
  const model = new BlockSearchController({
    searchBlock: async () => {
      throw new Error("failed");
    },
    revealMatch: vi.fn(),
    clearSearch: vi.fn(),
    onChange: vi.fn(),
  });
  model.find("x");
  await vi.waitFor(() => expect(model.state.pending).toBe(false));
  expect(model.state.error).toBeTruthy();
  expect(model.state.matches).toEqual([]);
  await model.dispose();
});
it("distinguishes a real empty output from unavailable or stale output", async () => {
  expect(
    await readAvailableBlockOutput(
      async () => "",
      "b1",
      () => true,
    ),
  ).toBe("");
  await expect(
    readAvailableBlockOutput(
      async () => null,
      "b1",
      () => true,
    ),
  ).rejects.toThrow("available");
  let current = true;
  let resolve!: (value: string) => void;
  const read = readAvailableBlockOutput(
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
    "b1",
    () => current,
  );
  current = false;
  resolve("old output");
  await expect(read).rejects.toThrow("available");
});
