import { create } from "zustand";
import { configureMcp, readMcpStatus } from "../lib/native";
import type { McpStatus } from "../lib/types";

const REFRESH_AFTER_MS = 30_000;

type McpState = {
  status: McpStatus | null;
  checkedAt: number;
  busy: "idle" | "checking" | "configuring";
  error: string | null;
};

export const useMcpStore = create<McpState>(() => ({
  status: null,
  checkedAt: 0,
  busy: "idle",
  error: null,
}));

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Re-read the CLI configs, at most every 30 s unless forced. Reading spawns
 *  `codex mcp get`, so it only runs when the button is shown or hovered. */
export async function refreshMcpStatus(force = false): Promise<void> {
  const { busy, checkedAt } = useMcpStore.getState();
  if (busy !== "idle") return;
  if (!force && Date.now() - checkedAt < REFRESH_AFTER_MS) return;
  useMcpStore.setState({ busy: "checking" });
  try {
    const status = await readMcpStatus();
    useMcpStore.setState({ status, checkedAt: Date.now(), error: null });
  } catch (e) {
    useMcpStore.setState({ error: message(e), checkedAt: Date.now() });
  } finally {
    useMcpStore.setState({ busy: "idle" });
  }
}

export async function configureMcpTargets(): Promise<McpStatus | null> {
  if (useMcpStore.getState().busy !== "idle") return null;
  useMcpStore.setState({ busy: "configuring" });
  try {
    const status = await configureMcp();
    useMcpStore.setState({ status, checkedAt: Date.now(), error: null });
    return status;
  } catch (e) {
    useMcpStore.setState({ error: message(e) });
    return null;
  } finally {
    useMcpStore.setState({ busy: "idle" });
  }
}
