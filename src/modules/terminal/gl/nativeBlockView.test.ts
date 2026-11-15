import type { NativeBlockSnapshot } from "./nativeBlocks";
import { expect, it, vi } from "vitest";
import { NativeBlockView } from "./nativeBlockView";
function fixture() {
  let active = true;
  const session = {
    drawnSeq: 1,
    blocks: vi.fn(async (): Promise<NativeBlockSnapshot | null> => null),
    readBlock: vi.fn(async () => ({
      command: "one",
      cwd: "/tmp",
      exitCode: 0,
      output: "one output",
    })),
    blockAction: vi.fn(async (command: Record<string, unknown>) => {
      if (command.kind === "find")
        return {
          kind: "matches" as const,
          version: 7,
          matches: [{ index: 0, line: 3, col: 2, len: 3 }],
        };
      if (command.kind === "reveal")
        return { kind: "revealed" as const, found: true };
      return { kind: "cleared" as const };
    }),
  };
  const view = new NativeBlockView({
    session,
    available: () => active,
    metrics: () => ({ height: 20, padding: 6 }),
    onError: vi.fn(),
  });
  return {
    view,
    session,
    hide: () => {
      active = false;
    },
    show: () => {
      active = true;
    },
  };
}
it("reads explicit native output and rejects a result after its view is hidden", async () => {
  const { view, session, hide } = fixture();
  expect(await view.readOutput("b1")).toBe("one output");
  let resolve!: (value: Awaited<ReturnType<typeof session.readBlock>>) => void;
  session.readBlock.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = view.readOutput("b1");
  hide();
  resolve({ command: "one", cwd: "/tmp", exitCode: 0, output: "old" });
  await expect(pending).rejects.toThrow("available");
  view.dispose();
});
it("reveals only a revisioned native token and clears its own process after hiding", async () => {
  const { view, session, hide } = fixture();
  const matches = await view.searchBlock("b1", "one");
  expect(matches).toEqual([
    { line: 3, col: 2, len: 3, native: { version: 7, index: 0 } },
  ]);
  expect(await view.revealMatch({ ...matches[0], line: 999 })).toBe(true);
  expect(session.blockAction).toHaveBeenLastCalledWith({
    kind: "reveal",
    version: 7,
    index: 0,
  });
  expect(await view.revealMatch({ line: 3, col: 2, len: 3 })).toBe(false);
  hide();
  await view.clearSearch();
  expect(session.blockAction).toHaveBeenLastCalledWith({ kind: "clearSearch" });
  view.dispose();
});
it("disposes a process projection instead of reusing its sequence on replacement", async () => {
  const first = fixture();
  const second = fixture();
  const changed = vi.fn();
  first.view.subscribe(changed);
  first.view.present(1);
  first.view.dispose();
  second.view.present(1);
  await Promise.resolve();
  await Promise.resolve();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(second.session.blocks).toHaveBeenCalledExactlyOnceWith(1);
  await expect(first.view.readOutput("b1")).rejects.toThrow("available");
  second.view.dispose();
});

it("recovers a discarded projection when the same drawn sequence becomes visible again", async () => {
  const { view, session, hide, show } = fixture();
  let resolve!: (value: NativeBlockSnapshot) => void;
  const snapshot: NativeBlockSnapshot = {
    seq: 1,
    metadataVersion: 2,
    hasAny: true,
    alternateScreen: false,
    viewportOffset: 0,
    viewportRows: 5,
    blocks: [
      {
        id: "b1",
        command: "one",
        cwd: "/tmp",
        exitCode: 0,
        running: false,
        headerLine: null,
        startLine: 0,
        endLine: 0,
        startedAt: 1,
        finishedAt: 2,
      },
    ],
  };
  session.blocks
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue(snapshot);
  view.present(1);
  hide();
  resolve(snapshot);
  await Promise.resolve();
  await Promise.resolve();
  expect(view.visible().blocks).toEqual([]);
  show();
  view.present(null);
  await vi.waitFor(() => expect(view.visible().blocks).toHaveLength(1));
  expect(session.blocks).toHaveBeenCalledTimes(2);
  view.dispose();
});
