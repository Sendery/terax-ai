import type { NotificationKind } from "./types";

const MAX_BODY = 120;

/**
 * What the bell calls each event.
 *
 * "turn ended" rather than "finished": Claude's Stop hook fires at the end of
 * every turn, so the old wording announced completion on every recap.
 */
export const NOTIFICATION_LABEL: Record<NotificationKind, string> = {
  attention: "needs input",
  "turn-end": "turn ended",
  exited: "exited",
  error: "failed",
};

const HEADLINE: Record<NotificationKind, (agent: string) => string> = {
  attention: (agent) => `${agent} needs your input`,
  "turn-end": (agent) => `${agent} finished its turn`,
  exited: (agent) => `${agent} exited`,
  error: (agent) => `${agent} failed`,
};

function oneLine(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_BODY
    ? `${collapsed.slice(0, MAX_BODY - 1)}…`
    : collapsed;
}

export type AgentEventDescription = { title: string; body: string };

/**
 * Turns a signal into the line a notification shows.
 *
 * The agent's own words win when it reported any: a permission prompt names
 * the tool it wants, which is the whole reason to read the notification. With
 * nothing reported it falls back to the tab, so a notification is never just an
 * agent name repeated twice.
 */
export function describeAgentEvent({
  kind,
  agent,
  text,
  tabTitle,
}: {
  kind: NotificationKind;
  agent: string;
  text?: string | null;
  tabTitle: string;
}): AgentEventDescription {
  const reported = text ? oneLine(text) : "";
  return {
    title: HEADLINE[kind](agent),
    body: reported || oneLine(tabTitle) || agent,
  };
}
