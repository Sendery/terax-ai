export type CliAgentId = "claude" | "codex" | "cursor" | "opencode" | "pi";

/** Mirror of the Rust `AgentCliEvent` (serde tag = "kind", camelCase). */
export type CliSpawnEvent =
  | { kind: "stdout"; line: string }
  | { kind: "stderr"; line: string }
  | { kind: "exit"; code: number | null }
  | { kind: "error"; message: string };

/** Permission posture passed to the wrapped CLI. CLIs run headless so they
 *  cannot prompt; we choose a non-interactive policy up front. */
export type CliPermissionMode = "default" | "acceptEdits" | "full";

/** Everything a CLI definition may use to plan one chat turn. */
export type CliRunContext = {
  messages: import("ai").UIMessage[];
  cwd: string | null;
  model?: string;
  permission: CliPermissionMode;
  chatSessionId: string | null;
  persona?: { name: string; instructions: string } | null;
  customInstructions?: string;
  planMode?: boolean;
  /** Caller-supplied uniqueness token so planning stays pure. */
  nonce: string;
};

/** How to spawn one turn. `stdin` carries the prompt when argv would be
 *  unsafe or too small; `bridge` hands the child this instance's Pi bridge;
 *  `metadata` is attached to the assistant message once the run is real. */
export type CliRunPlan = {
  argv: string[];
  stdin?: string;
  bridge?: boolean;
  metadata?: Record<string, unknown>;
};
