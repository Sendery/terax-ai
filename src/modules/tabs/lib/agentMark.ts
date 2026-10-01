import { TONE_MARK } from "@/modules/agents/lib/marks";
import type { AgentTabStatus } from "@/modules/terminal";

/**
 * The same mark the notification for this state carries, so a tab and the
 * banner it raised read as one signal. Working has no notification and keeps
 * the dot alone.
 */
export function tabStateMark(status: AgentTabStatus): string | null {
  if (status.top === "finished") return TONE_MARK["turn-end"];
  if (status.top !== "attention") return null;
  return TONE_MARK[status.reason ?? "attention"];
}
