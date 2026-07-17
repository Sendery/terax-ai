/**
 * Pure presentation helpers: human labels, derived titles, and accessible
 * announcements for note cards. No React, no icon components (those live in the
 * view layer). Accessible labels must include state that would otherwise only
 * be conveyed by color or icon.
 */
import type {
  CiState,
  JiraStatusCategory,
  NoteCard,
  PrState,
} from "./cards";

const KIND_LABELS: Record<NoteCard["kind"], string> = {
  text: "Text",
  link: "Link",
  "github-pr": "GitHub PR",
  jira: "Jira",
  notion: "Notion",
  figma: "Figma",
  obsidian: "Obsidian",
};

export function cardKindLabel(card: NoteCard): string {
  return KIND_LABELS[card.kind];
}

const PR_STATE_LABELS: Record<PrState, string> = {
  open: "open",
  draft: "draft",
  merged: "merged",
  closed: "closed",
  unknown: "status unknown",
};

const CI_STATE_LABELS: Record<CiState, string> = {
  success: "passing",
  failure: "failing",
  pending: "running",
  error: "error",
  none: "no checks",
};

const JIRA_STATUS_LABELS: Record<JiraStatusCategory, string> = {
  todo: "to do",
  "in-progress": "in progress",
  done: "done",
  unknown: "status unknown",
};

export function prStateLabel(state: PrState): string {
  return PR_STATE_LABELS[state];
}

export function ciStateLabel(state: CiState): string {
  return CI_STATE_LABELS[state];
}

export function jiraStatusLabel(state: JiraStatusCategory): string {
  return JIRA_STATUS_LABELS[state];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/** Display title for a card, deriving a sensible label when none is set. */
export function cardTitle(card: NoteCard): string {
  if (card.title && card.title.trim()) return card.title.trim();
  switch (card.kind) {
    case "text": {
      const line = firstLine(card.body);
      return line || "Untitled note";
    }
    case "github-pr": {
      if (card.owner && card.repo && typeof card.number === "number") {
        return `${card.owner}/${card.repo} #${card.number}`;
      }
      return hostOf(card.url);
    }
    case "jira":
      return card.issueKey ?? hostOf(card.url);
    default:
      return hostOf(card.url);
  }
}

/** Screen-reader label. Includes lifecycle/CI/status information so meaning is
 *  not carried by icon or color alone. */
export function cardAccessibleLabel(card: NoteCard): string {
  const title = cardTitle(card);
  switch (card.kind) {
    case "text":
      return `Text note: ${title}`;
    case "github-pr":
      return `GitHub PR ${title}. Pull request ${prStateLabel(
        card.prState,
      )}. Checks ${ciStateLabel(card.ciState)}.`;
    case "jira":
      return `Jira issue ${title}. ${jiraStatusLabel(card.status)}.`;
    default:
      return `${cardKindLabel(card)} link: ${title}`;
  }
}
