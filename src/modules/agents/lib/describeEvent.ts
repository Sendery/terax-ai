import type { TabColor } from "@/modules/tabs";
import type {
  AttentionReason,
  DigestTaskKind,
  NotificationKind,
  NotificationTone,
  SessionDigest,
} from "./types";

const MAX_BODY = 280;

/**
 * Transcript timestamps and the pane's start come from different clocks and
 * the first task can be launched within the first second, so a small margin
 * keeps it from being dropped as stale.
 */
const TASK_CLOCK_SKEW_MS = 5_000;

/**
 * What the bell calls each event.
 *
 * "turn ended" rather than "finished": Claude's Stop hook fires at the end of
 * every turn, so the old wording announced completion on every recap.
 */
const NOTIFICATION_LABEL: Record<NotificationKind, string> = {
  attention: "needs input",
  "turn-end": "turn ended",
  subagent: "subagent done",
  exited: "exited",
  error: "failed",
};

const REASON_LABEL: Record<AttentionReason, string> = {
  permission: "needs permission",
  question: "is asking you",
  idle: "is waiting for your prompt",
};

/** The bell's label for one notification, naming the block when it is known. */
export function notificationLabel(
  kind: NotificationKind,
  reason?: AttentionReason,
): string {
  if (kind === "attention" && reason) return REASON_LABEL[reason];
  return NOTIFICATION_LABEL[kind];
}

// macOS draws the notification itself, so colour can only travel as text.
// Emoji are written as escapes to keep the source free of them. The tab mark
// is a coloured circle; there are fewer circles than tab colours, so teal,
// indigo and pink share their nearest one and the subtitle still names the
// tab. State marks are pictographs, so the two never read as each other.
export const TAB_COLOR_MARK: Record<TabColor, string> = {
  red: "\u{1F534}",
  orange: "\u{1F7E0}",
  amber: "\u{1F7E1}",
  green: "\u{1F7E2}",
  teal: "\u{1F7E2}",
  blue: "\u{1F535}",
  indigo: "\u{1F535}",
  purple: "\u{1F7E3}",
  pink: "\u{1F7E3}",
};
export const NO_TAB_COLOR_MARK = "\u26AA";

export const TONE_MARK: Record<NotificationTone, string> = {
  permission: "\u{1F510}",
  question: "\u2753",
  idle: "\u{1F4AC}",
  attention: "\u{1F514}",
  "turn-end": "\u2705",
  subagent: "\u{1F9E9}",
  error: "\u274C",
  exited: "\u{1F3C1}",
};

function oneLine(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_BODY
    ? `${collapsed.slice(0, MAX_BODY - 1)}…`
    : collapsed;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Tasks the running process owns. A resumed session inherits transcript
 * entries whose completion the previous process never lived to write, so
 * anything started before this process is not running now.
 */
export function liveTasks(
  tasks: SessionDigest["tasks"],
  startedAt: number,
): SessionDigest["tasks"] {
  return tasks.filter(
    (task) => task.startedAt >= startedAt - TASK_CLOCK_SKEW_MS,
  );
}

/** Background work still running, as the subtitle reads it. */
export function describeTasks(tasks: SessionDigest["tasks"]): string | null {
  const count: Record<DigestTaskKind, number> = {
    subagent: 0,
    monitor: 0,
    loop: 0,
    background: 0,
  };
  for (const task of tasks) count[task.kind]++;
  const parts = [
    count.subagent && plural(count.subagent, "subagent", "subagents"),
    count.monitor && plural(count.monitor, "monitor", "monitors"),
    count.loop && plural(count.loop, "loop", "loops"),
    count.background &&
      plural(count.background, "background job", "background jobs"),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The summary to show for a session: the agent's own recap when it is the
 * newest thing it wrote, else its last reply. A recap from yesterday next to a
 * reply from a minute ago would describe the wrong moment.
 */
export function sessionSummary(
  digest: SessionDigest | undefined,
): string | null {
  if (!digest) return null;
  const { recap, recapAt, lastReply, lastReplyAt } = digest;
  if (recap && (!lastReply || (recapAt ?? 0) >= (lastReplyAt ?? 0)))
    return recap;
  return lastReply ?? recap;
}

function toneFor(
  kind: NotificationKind,
  reason?: AttentionReason,
): NotificationTone {
  if (kind === "attention") return reason ?? "attention";
  return kind;
}

export type AgentEventDescription = {
  title: string;
  subtitle: string;
  body: string;
  tone: NotificationTone;
};

/**
 * Turns an agent event into what a notification says.
 *
 * The title is the tab's colour mark, the state's mark and the session name;
 * the subtitle says which tab it lives in and what it still has running (the
 * agent is the image, see `notificationBadge.ts`); the body is the most
 * specific thing available, in order: the question it is blocked on, what the
 * agent said with the event, and its latest summary. A notification is never
 * just "Terax needs attention".
 */
export function describeAgentEvent({
  kind,
  reason,
  agentLabel,
  tabTitle,
  text,
  digest,
  startedAt,
  tabColor,
}: {
  kind: NotificationKind;
  reason?: AttentionReason | null;
  agentLabel: string;
  tabTitle: string;
  text?: string | null;
  digest?: SessionDigest;
  /** The running process's start, so tasks a previous process left open are dropped. */
  startedAt?: number;
  tabColor?: TabColor | null;
}): AgentEventDescription {
  const why = reason ?? undefined;
  const tone = toneFor(kind, why);
  const sessionName = digest?.name?.trim() || tabTitle.trim() || agentLabel;
  const colorMark = tabColor ? TAB_COLOR_MARK[tabColor] : NO_TAB_COLOR_MARK;

  const tasks = digest
    ? describeTasks(
        startedAt === undefined
          ? digest.tasks
          : liveTasks(digest.tasks, startedAt),
      )
    : null;
  // The agent is not named here: its logo is the notification's image.
  const where = [
    sessionName !== tabTitle.trim() && tabTitle.trim() ? tabTitle.trim() : null,
    tasks,
    digest?.prs.length
      ? `PR #${digest.prs[digest.prs.length - 1].number}`
      : null,
  ].filter((part): part is string => Boolean(part));

  const question =
    kind === "attention" && why === "question" ? digest?.pendingQuestion : null;
  const body =
    // The summary closes the list for every kind: before a question it is the
    // context the agent wrote while asking.
    [question, text, sessionSummary(digest)]
      .map((part) => (part ? oneLine(part) : ""))
      .find(Boolean) ?? "";

  // The marks lead because macOS truncates the title: they always survive.
  return {
    title: `${colorMark} ${TONE_MARK[tone]} ${sessionName}`,
    subtitle: where.join(" · "),
    body,
    tone,
  };
}
