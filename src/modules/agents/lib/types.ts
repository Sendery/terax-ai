export type AgentStatus = "working" | "waiting";

export type AgentIntegration =
  | "pi-extension"
  | "claude-hook"
  | "pty-detection";

/** Explicit harness identity used for presentation, never inferred from terminal output. */
export type AgentHarness = "pi" | "claude" | "codex" | "generic";

export type AgentSource = "terminal" | "local";

export type AgentSignalKind =
  | "started"
  | "working"
  | "attention"
  | "finished"
  | "exited";

export type AgentSignal = {
  id: number;
  kind: AgentSignalKind;
  agent: string | null;
};

export type AgentSession = {
  leafId: number;
  tabId: number;
  agent: string;
  status: AgentStatus;
  startedAt: number;
  lastActivityAt: number;
  attentionSince: number | null;
  lastSignal: AgentSignalKind;
  integration: AgentIntegration;
  harness: AgentHarness;
};

export type AgentNotification = {
  id: string;
  source: AgentSource;
  leafId: number;
  tabId: number;
  agent: string;
  kind: NotificationKind;
  at: number;
  read: boolean;
};

export type NotificationKind = "attention" | "finished" | "error";

export type LocalAgentState = {
  agent: string;
  status: AgentStatus;
} | null;
