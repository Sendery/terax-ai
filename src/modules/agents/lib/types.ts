import type { TabColor } from "@/modules/tabs";

export type AgentStatus = "working" | "waiting";

export type AgentIntegration = "pi-extension" | "claude-hook" | "pty-detection";

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
  /** Line the agent attached to the event, bounded and stripped by Rust. */
  text?: string | null;
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
  /** What the agent said, when it said anything. */
  text?: string;
  /** Title of the tab it happened in, so a row names where to go. */
  tabTitle: string;
  /** The tab's palette colour, so a row is recognisable at a glance. */
  tabColor: TabColor | null;
};

/**
 * What a notification is telling you.
 *
 * `turn-end` and `exited` are deliberately separate: an agent handing the turn
 * back is a recap, an agent whose process ended is done. Collapsing them into
 * one "finished" made every recap read as completion.
 */
export type NotificationKind = "attention" | "turn-end" | "exited" | "error";

export type LocalAgentState = {
  agent: string;
  status: AgentStatus;
} | null;
