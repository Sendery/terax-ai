import { currentWorkspaceEnv } from "@/modules/workspace";
import type {
  PtyHandlers,
  PtySession,
} from "@/modules/terminal/lib/pty-bridge";
import { Channel, invoke } from "@tauri-apps/api/core";

/** Same backend as production; retain late data after exit until the lab's drain barrier closes. */
export async function openLabPty(
  cols: number,
  rows: number,
  handlers: PtyHandlers,
): Promise<PtySession> {
  const onData = new Channel<ArrayBuffer>();
  const onExit = new Channel<number>();
  onData.onmessage = (buffer) => handlers.onData(new Uint8Array(buffer));
  onExit.onmessage = (code) => handlers.onExit?.(code);
  const id = await invoke<number>("pty_open", {
    cols,
    rows,
    cwd: null,
    workspace: currentWorkspaceEnv(),
    blocks: false,
    onData,
    onExit,
  });
  let closed = false;
  const encoder = new TextEncoder();
  return {
    id,
    write: (text) =>
      invoke("pty_write", encoder.encode(text), {
        headers: { "x-pty-id": String(id) },
      }),
    resize: (cols, rows) => invoke("pty_resize", { id, cols, rows }),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await invoke("pty_close", { id });
      } finally {
        onData.onmessage = () => {};
        onExit.onmessage = () => {};
      }
    },
  };
}
