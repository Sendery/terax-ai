import { expect, it, vi } from "vitest";
import type {
  PaneCallbacks,
  RenderPane,
  TerminalRenderer,
} from "@/modules/terminal/gl/gridRenderer";
import { encodeFrame, textRow } from "@/modules/terminal/gl/frameCodec.testing";
import { FRAME_FLAG_FULL } from "@/modules/terminal/gl/frameCodec";
import { RenderCapacityError } from "@/modules/terminal/gl/renderCapacity";
const ipc = vi.hoisted(() => ({
  calls: [] as { command: string; args: unknown }[],
  open: null as null | ((id: number) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = (_message: unknown) => {};
  },
  invoke: (command: string, args: unknown) => {
    ipc.calls.push({ command, args });
    if (command === "gterm_open")
      return new Promise<number>((resolve) => {
        ipc.open = resolve;
      });
    return Promise.resolve(null);
  },
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
import { EngineSession } from "@/modules/terminal/gl/engineSession";
it("reports presentation capacity, invalidates capture metadata and returns credits without killing the native session", async () => {
  let callbacks: PaneCallbacks = {
    onDrawn: () => {},
    onNeedFullFrame: () => {},
  };
  const pane = {} as RenderPane;
  const renderer = {
    addPane: (value: PaneCallbacks) => {
      callbacks = value;
      return pane;
    },
    setPaneFocused: vi.fn(),
    removePane: vi.fn(),
    applyFrame: () => "applied",
    markUndrawn: vi.fn(),
  } as unknown as TerminalRenderer;
  const onError = vi.fn();
  const pending = EngineSession.open(renderer, {
    cols: 4,
    rows: 2,
    observer: { onError },
  });
  ipc.open?.(9);
  const session = await pending;
  const args = ipc.calls.find((call) => call.command === "gterm_open")
    ?.args as { onFrame: { onmessage: (value: ArrayBuffer) => void } };
  args.onFrame.onmessage(
    encodeFrame({
      seq: 1,
      cols: 4,
      rows: 2,
      flags: FRAME_FLAG_FULL,
      rowRecords: [textRow(0, "ok")],
    }),
  );
  callbacks.onError?.(new RenderCapacityError());
  callbacks.onDrawn(false);
  expect(onError).toHaveBeenCalledOnce();
  expect(session.drawnSeq).toBe(null);
  expect(
    ipc.calls
      .filter((call) => call.command === "gterm_credit")
      .map((call) => call.args),
  ).toEqual([{ id: 9, seq: 1 }]);
  await session.write("healthy input");
  expect(ipc.calls.filter((call) => call.command === "pty_write")).toHaveLength(
    1,
  );
  expect(session.id).toBe(9);
  await session.close();
});
