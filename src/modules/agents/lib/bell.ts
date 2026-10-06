import { notificationLabel } from "./describeEvent";
import { displayAgent } from "./format";
import { TONE_MARK } from "./marks";
import type { AgentNotification } from "./types";

/**
 * The bell's count. Only unread notifications: counting every waiting session
 * kept the badge up for as long as any agent sat at its prompt, which with a
 * few Claude panes was always, however much was read.
 */
export function bellBadgeCount(
  notifications: readonly AgentNotification[],
): number {
  return notifications.reduce((count, n) => count + (n.read ? 0 : 1), 0);
}

export type BellRowView = {
  /** Same state mark as the native notification's title and the tab badge. */
  mark: string;
  name: string;
  label: string;
  /** The most specific thing known: question, the agent's words or its summary. */
  detail: string | null;
  /** Running tasks and PR; the tab has its own chip. */
  where: string | null;
};

export function bellRowView(n: AgentNotification): BellRowView {
  const tab = n.tabTitle.trim();
  const where = (n.subtitle ?? "")
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part && part !== tab)
    .join(" · ");
  return {
    mark: TONE_MARK[n.tone],
    name: n.sessionName ?? displayAgent(n.agent),
    label: notificationLabel(n.kind, n.reason),
    detail: n.body || n.text || null,
    where: where || null,
  };
}
