import { expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  args: null as null | Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = (_value: unknown) => {};
  },
  invoke: vi.fn((command: string, args: Record<string, unknown>) => {
    if (command === "pty_open") {
      ipc.args = args;
      return Promise.resolve(12);
    }
    return Promise.resolve();
  }),
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));

it("retains data delivered after exit until explicit lab close", async () => {
  const { openLabPty } = await import("@/terminal-lab/lib/labPty");
  const onData = vi.fn();
  const onExit = vi.fn();
  const pty = await openLabPty(100, 30, { onData, onExit });
  const exit = ipc.args?.onExit as { onmessage: (code: number) => void };
  const data = ipc.args?.onData as { onmessage: (data: ArrayBuffer) => void };
  exit.onmessage(0);
  data.onmessage(new Uint8Array([1, 2]).buffer);
  expect(onExit).toHaveBeenCalledWith(0);
  expect(onData).toHaveBeenCalledWith(new Uint8Array([1, 2]));
  await pty.close();
  data.onmessage(new Uint8Array([3]).buffer);
  expect(onData).toHaveBeenCalledTimes(1);
});
