import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { TAB_COLOR_CSS, type TabColor } from "@/modules/tabs";
import { useAgentStore } from "../store/agentStore";
import { displayAgent } from "./format";
import { agentBadgePng } from "./notificationBadge";
import { osNotify } from "./notify";
import type {
  AgentSource,
  AttentionReason,
  NotificationKind,
  NotificationTone,
} from "./types";

type RouteArgs = {
  source: AgentSource;
  agent: string;
  kind: NotificationKind;
  reason?: AttentionReason | null;
  title: string;
  subtitle?: string;
  body?: string;
  tone: NotificationTone;
  /** True when the user is currently looking at this agent. */
  visible: boolean;
  focused: boolean;
  tabId?: number;
  leafId?: number;
  /** What the agent reported, kept on the notification so the bell can show it. */
  text?: string;
  tabTitle?: string;
  tabColor?: TabColor | null;
  sessionName?: string;
};

/**
 * Two hooks can describe one block: a question fires `PreToolUse` at once and
 * `Notification` again once Claude has idled. The second adds nothing, so a
 * repeat of the same event for the same pane inside this window is dropped.
 */
const DUPLICATE_WINDOW_MS = 4_000;

const lastPosted = new Map<string, number>();

export function isDuplicate(key: string, now: number): boolean {
  const previous = lastPosted.get(key);
  lastPosted.set(key, now);
  if (lastPosted.size > 256) {
    for (const [stale, at] of lastPosted) {
      if (now - at > DUPLICATE_WINDOW_MS) lastPosted.delete(stale);
    }
  }
  return previous !== undefined && now - previous < DUPLICATE_WINDOW_MS;
}

/**
 * Records an agent event and posts it as a native notification.
 *
 * There is one channel: the operating system's. The bell keeps the history,
 * and nothing is posted for an agent the user is already looking at in a
 * focused window.
 */
export function routeAgentNotification({
  source,
  agent,
  kind,
  reason,
  title,
  subtitle,
  body,
  tone,
  visible,
  focused,
  tabId = 0,
  leafId = 0,
  text,
  tabTitle = "",
  tabColor = null,
  sessionName,
}: RouteArgs): void {
  if (!usePreferencesStore.getState().agentNotifications) return;
  if (focused && visible) return;
  if (isDuplicate(`${source}:${leafId}:${kind}:${reason ?? ""}`, Date.now()))
    return;

  useAgentStore.getState().pushNotification({
    source,
    agent,
    kind,
    tabId,
    leafId,
    tabTitle,
    tabColor,
    ...(text ? { text } : {}),
    ...(reason ? { reason } : {}),
    ...(sessionName ? { sessionName } : {}),
  });

  const accent = tabColor ? TAB_COLOR_CSS[tabColor] : null;
  // The plain notification has no image, so it names the agent in words.
  const fallback = () =>
    void osNotify(
      title,
      [[displayAgent(agent), subtitle].filter(Boolean).join(" · "), body]
        .filter(Boolean)
        .join("\n"),
    );

  void agentBadgePng(agent, accent)
    .then((icon) =>
      native.agentNotify({
        title,
        ...(subtitle ? { subtitle } : {}),
        ...(body ? { body } : {}),
        ...(accent ? { accent } : {}),
        ...(icon ? { icon } : {}),
        tone,
        ...(source === "terminal" ? { leafId, tabId } : {}),
      }),
    )
    .then((posted) => {
      // Only macOS has the rich path; elsewhere the plain notification carries
      // the same words.
      if (!posted) fallback();
    })
    .catch(fallback);
}
