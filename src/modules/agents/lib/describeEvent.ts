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

const STATE: Record<NotificationKind, string> = {
  attention: "needs your input",
  // The turn is over and the next move is the user's, which is what they need
  // to know; "finished" alone read as the whole task being done.
  "turn-end": "finished, waiting for your prompt",
  subagent: "has a subagent result",
  exited: "exited",
  error: "failed",
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
 * The title names the session and what it needs; the subtitle says where it
 * lives (tab, agent) and what it still has running; the body is the most
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
}: {
  kind: NotificationKind;
  reason?: AttentionReason | null;
  agentLabel: string;
  tabTitle: string;
  text?: string | null;
  digest?: SessionDigest;
  /** The running process's start, so tasks a previous process left open are dropped. */
  startedAt?: number;
}): AgentEventDescription {
  const why = reason ?? undefined;
  const sessionName = digest?.name?.trim() || tabTitle.trim() || agentLabel;
  const state = kind === "attention" && why ? REASON_LABEL[why] : STATE[kind];

  const tasks = digest
    ? describeTasks(
        startedAt === undefined
          ? digest.tasks
          : liveTasks(digest.tasks, startedAt),
      )
    : null;
  const where = [
    sessionName !== tabTitle.trim() && tabTitle.trim() ? tabTitle.trim() : null,
    agentLabel,
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

  return {
    title: `${sessionName} ${state}`,
    subtitle: where.join(" · "),
    body,
    tone: toneFor(kind, why),
  };
}
