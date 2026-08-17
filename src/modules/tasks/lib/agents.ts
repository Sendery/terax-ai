/**
 * Which agent CLI a scheduled task drives. The three are not interchangeable:
 * they differ in how a session is named, whether a provider or thinking level
 * can be set, and how a non-interactive run is spelled. Those differences are
 * declared here once, verified against the installed CLIs, so the argv builder
 * and the editor never guess.
 */
export type TaskAgent = "pi" | "claude" | "codex";

export const TASK_AGENTS: readonly TaskAgent[] = ["pi", "claude", "codex"];

export const DEFAULT_TASK_AGENT: TaskAgent = "pi";

export function isTaskAgent(value: unknown): value is TaskAgent {
  return (
    typeof value === "string" && TASK_AGENTS.includes(value as TaskAgent)
  );
}

const LABELS: Record<TaskAgent, string> = {
  pi: "Pi",
  claude: "Claude Code",
  codex: "Codex",
};

export function agentLabel(agent: TaskAgent): string {
  return LABELS[agent];
}

/**
 * How a session id can be pinned:
 * - `arbitrary`: any string works (`pi --session-id`).
 * - `uuid`: only a UUID is accepted (`claude --session-id <uuid>`).
 * - `none`: the CLI mints its own id and the best we can do is resume the most
 *   recent one (`codex resume --last`).
 */
export type SessionNaming = "arbitrary" | "uuid" | "none";

export type AgentCapabilities = {
  binary: string;
  provider: boolean;
  thinking: boolean;
  session: SessionNaming;
};

const CAPABILITIES: Record<TaskAgent, AgentCapabilities> = {
  pi: { binary: "pi", provider: true, thinking: true, session: "arbitrary" },
  claude: { binary: "claude", provider: false, thinking: false, session: "uuid" },
  codex: { binary: "codex", provider: false, thinking: false, session: "none" },
};

export function agentCapabilities(agent: TaskAgent): AgentCapabilities {
  return CAPABILITIES[agent];
}

export type ModelPreset = {
  /** Passed verbatim to the CLI's model flag. */
  value: string;
  label: string;
};

/**
 * Short model names each CLI resolves. Deliberately curated rather than
 * discovered: spawning an agent to list models on every editor open would be
 * slow and would need workspace authorization. A task can always carry a custom
 * value instead.
 *
 * Pi's presets are provider qualified on purpose. `--model` takes a pattern,
 * and a bare pattern that several configured providers can satisfy is rejected
 * at run time ("is ambiguous across providers"), which would turn a preset into
 * a guaranteed failure on any machine with more than one provider. Qualifying
 * the provider keeps the preset both unambiguous and version agnostic.
 */
const MODEL_PRESETS: Record<TaskAgent, readonly ModelPreset[]> = {
  pi: [
    { value: "anthropic/sonnet", label: "Claude Sonnet" },
    { value: "anthropic/opus", label: "Claude Opus" },
    { value: "anthropic/haiku", label: "Claude Haiku" },
    { value: "openai/gpt-5", label: "GPT-5" },
    { value: "google/gemini", label: "Gemini" },
  ],
  claude: [
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
  ],
  codex: [
    { value: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
    { value: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex mini" },
    { value: "gpt-5.1", label: "GPT-5.1" },
  ],
};

export function agentModelPresets(agent: TaskAgent): readonly ModelPreset[] {
  return MODEL_PRESETS[agent];
}

/**
 * A fresh session seed. It is a UUID because `claude --session-id` accepts
 * nothing else, and because a task's session id must not collide with the one
 * it had before the user asked for a fresh start.
 */
export function newSessionSeed(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // Non-secure fallback for environments without WebCrypto. Session ids are
  // identifiers, not secrets, so Math.random is acceptable here.
  const hex = (length: number) =>
    Array.from({ length }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
  const variant = "89ab"[Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}
