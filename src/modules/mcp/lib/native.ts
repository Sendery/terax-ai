import { invoke } from "@tauri-apps/api/core";
import type { McpStatus } from "./types";

/** Where `terax --mcp` is registered among the installed agent CLIs. */
export function readMcpStatus(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_status");
}

/** Register or repair `terax --mcp` on every installed agent CLI. */
export function configureMcp(): Promise<McpStatus> {
  return invoke<McpStatus>("mcp_configure");
}
