import { expect, it, vi } from "vitest";
import {
  decodeNativeBlocks,
  decodeNativeBlockOutput,
  projectNativeBlocks,
  NativeBlockProjection,
} from "@/modules/terminal/gl/nativeBlocks";
const data = (seq = 1, offset = 0) => ({
  seq,
  metadataVersion: 2,
  hasAny: true,
  alternateScreen: false,
  viewportOffset: offset,
  viewportRows: 5,
  blocks: [
    {
      id: "b1",
      command: "printf one",
      cwd: "/workspace",
      exitCode: 0,
      running: false,
      startLine: 2,
      endLine: 3,
      startedAt: 1,
      finishedAt: 2,
    },
  ],
});
it("validates the exact presented frame and bounded block metadata", () => {
  expect(decodeNativeBlocks(data(), 1)).toEqual(data());
  for (const bad of [
    { seq: 2 },
    { viewportRows: 501 },
    { viewportOffset: -1 },
    { metadataVersion: NaN },
    { hasAny: 1 },
    { alternateScreen: "false" },
    { blocks: Array(1002).fill(data().blocks[0]) },
    { blocks: [{ ...data().blocks[0], id: "b0" }] },
    { blocks: [{ ...data().blocks[0], id: "b18446744073709551616" }] },
    { blocks: [{ ...data().blocks[0], startLine: 4, endLine: 3 }] },
    { blocks: [{ ...data().blocks[0], command: "x".repeat(4097) }] },
    { blocks: [{ ...data().blocks[0], cwd: "relative" }] },
    { blocks: [data().blocks[0], data().blocks[0]] },
  ])
    expect(() => decodeNativeBlocks({ ...data(), ...bad }, 1)).toThrow(
      "invalid",
    );
});
it("bounds explicit output reads and rejects unexpected command or path controls", () => {
  const output = {
    command: "printf one",
    cwd: "/workspace",
    exitCode: 0,
    output: "one",
  };
  expect(decodeNativeBlockOutput(output)).toEqual(output);
  expect(decodeNativeBlockOutput(null)).toBeNull();
  for (const patch of [
    { output: "x".repeat(1024 * 1024 + 1) },
    { command: "bad\u0000text" },
    { cwd: "/workspace\nother" },
    { exitCode: 1.5 },
  ])
    expect(() => decodeNativeBlockOutput({ ...output, ...patch })).toThrow(
      "invalid",
    );
});
it("projects native rows using the actual viewport and cell metrics", () => {
  const snapshot = decodeNativeBlocks(data(1, 3), 1);
  const visible = projectNativeBlocks(snapshot, 20, 6);
  expect(visible.blocks[0]).toMatchObject({
    top: -14,
    bottom: 26,
    headerTop: -52,
    ok: true,
  });
  expect(visible.sticky?.id).toBe("b1");
  expect(
    projectNativeBlocks({ ...snapshot, alternateScreen: true }, 20, 6),
  ).toEqual({ blocks: [], sticky: null });
  expect(projectNativeBlocks(snapshot, 0, 6)).toEqual({
    blocks: [],
    sticky: null,
  });
});
it("coalesces pending frame queries and never paints an older presented frame", async () => {
  let presented = 1;
  const pending = new Map<number, (value: unknown) => void>();
  const request = vi.fn(
    (seq: number) =>
      new Promise<unknown>((resolve) => pending.set(seq, resolve)),
  );
  const model = new NativeBlockProjection({
    request: async (seq) => decodeNativeBlocks(await request(seq), seq),
    presented: () => presented,
    metrics: () => ({ height: 20, padding: 6 }),
  });
  model.present(1);
  presented = 2;
  model.present(2);
  presented = 3;
  model.present(3);
  expect(request.mock.calls).toEqual([[1]]);
  requireFixture(pending.get(1))(data(1));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(model.visible()).toEqual({ blocks: [], sticky: null });
  expect(request.mock.calls).toEqual([[1], [3]]);
  requireFixture(pending.get(3))(data(3));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(model.visible().blocks[0].id).toBe("b1");
  model.dispose();
});
it("updates projection without deduplicating geometry by metadataVersion and drops disposed replies", async () => {
  let presented = 1;
  let height = 20;
  const model = new NativeBlockProjection({
    request: async (seq) =>
      decodeNativeBlocks(data(seq, seq === 1 ? 0 : 2), seq),
    presented: () => presented,
    metrics: () => ({ height, padding: 6 }),
  });
  const changed = vi.fn();
  model.subscribe(changed);
  model.present(1);
  await Promise.resolve();
  await Promise.resolve();
  expect(model.visible().blocks[0].top).toBe(46);
  presented = 2;
  model.present(2);
  await Promise.resolve();
  await Promise.resolve();
  expect(model.visible().blocks[0].top).toBe(6);
  height = 10;
  model.layout();
  expect(model.visible().blocks[0].bottom).toBe(26);
  model.dispose();
  model.present(3);
  expect(model.visible()).toEqual({ blocks: [], sticky: null });
});

function requireFixture<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing test fixture");
  return value;
}
