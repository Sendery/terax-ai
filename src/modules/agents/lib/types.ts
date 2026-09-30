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
  | "subagent"
  | "bound"
  | "exited";

/** The colour and sound a native notification carries, one per situation. */
export type NotificationTone =
  | "permission"
  | "question"
  | "idle"
  | "attention"
  | "turn-end"
  | "subagent"
  | "error"
  | "exited";

/** Why an agent is blocked, when its hook could tell. */
export type AttentionReason = "permission" | "question" | "idle";

export type AgentSignal = {
  id: number;
  kind: AgentSignalKind;
  agent: string | null;
  /** Line the agent attached to the event, bounded and stripped by Rust. */
  text?: string | null;
  reason?: AttentionReason | null;
  /** Only on `bound`: the transcript this pane is writing. */
  sessionId?: string | null;
};

export type DigestTaskKind = "subagent" | "monitor" | "background" | "loop";

/** Mirror of the Rust `SessionDigest`: what the transcript says the session is. */
export type SessionDigest = {
  sessionId: string | null;
  name: string | null;
  recap: string | null;
  recapAt: number | null;
  lastReply: string | null;
  lastReplyAt: number | null;
  goal: string | null;
  pendingQuestion: string | null;
  prs: { number: number; url: string; repo: string }[];
  artifacts: { url: string; title: string }[];
  tasks: { kind: DigestTaskKind; label: string; startedAt: number }[];
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
  /** Set while waiting, when the hook said why. */
  lastReason: AttentionReason | null;
  /** The transcript the agent reported, once its hooks bound the pane. */
  sessionId: string | null;
  /**
   * The PTY the signals come from. `exited` arrives after a closed pane has
   * dropped its leaf-to-pty mapping, so this is what still names the session
   * to finish.
   */
  ptyId: number | null;
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
  reason?: AttentionReason;
  /** The session's own name, when its transcript has one. */
  sessionName?: string;
};

/**
 * What a notification is telling you.
 *
 * `turn-end` and `exited` are deliberately separate: an agent handing the turn
 * back is a recap, an agent whose process ended is done. Collapsing them into
 * one "finished" made every recap read as completion.
 */
export type NotificationKind =
  | "attention"
  | "turn-end"
  | "subagent"
  | "exited"
  | "error";

export type LocalAgentState = {
  agent: string;
  status: AgentStatus;
} | null;
