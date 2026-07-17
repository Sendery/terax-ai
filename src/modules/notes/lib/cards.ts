/**
 * Notes domain model. Pure, dependency-light: types, provider detection, URL
 * parsing, card factories and a hydration-safe validator. No React, no Tauri,
 * no network. Live enrichment (GitHub CI/PR, Jira status) is layered on top in
 * later slices; the model only carries the resulting typed fields.
 */

/** Closed set of card kinds. `link` is the generic fallback for a URL whose
 *  provider we do not specialise. */
export type NoteCardKind =
  | "text"
  | "link"
  | "jira"
  | "github-pr"
  | "notion"
  | "figma"
  | "obsidian";

/** Provider inferred from a URL. `generic` -> a plain link card. */
export type NoteProvider =
  | "jira"
  | "github-pr"
  | "notion"
  | "figma"
  | "obsidian"
  | "generic";

/** GitHub pull-request lifecycle state. `unknown` until a live fetch resolves. */
export type PrState = "open" | "draft" | "merged" | "closed" | "unknown";

/** CI/checks roll-up for a PR. `none` = not yet fetched / no checks. */
export type CiState = "success" | "failure" | "pending" | "error" | "none";

/** Jira status category. `unknown` until a live fetch resolves. */
export type JiraStatusCategory = "todo" | "in-progress" | "done" | "unknown";

export const PR_STATES: readonly PrState[] = [
  "open",
  "draft",
  "merged",
  "closed",
  "unknown",
];

export const CI_STATES: readonly CiState[] = [
  "success",
  "failure",
  "pending",
  "error",
  "none",
];

export const JIRA_STATUS_CATEGORIES: readonly JiraStatusCategory[] = [
  "todo",
  "in-progress",
  "done",
  "unknown",
];

type NoteCardBase = {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export type TextCard = NoteCardBase & {
  kind: "text";
  title?: string;
  body: string;
};

type LinkCardBase = NoteCardBase & {
  url: string;
  title?: string;
  /** Free-form user annotation attached to the link. */
  note?: string;
};

export type LinkCard = LinkCardBase & { kind: "link" };

export type JiraCard = LinkCardBase & {
  kind: "jira";
  issueKey?: string;
  status: JiraStatusCategory;
  /** Last resolved human-readable status name, if any. */
  statusName?: string;
};

export type GithubPrCard = LinkCardBase & {
  kind: "github-pr";
  owner?: string;
  repo?: string;
  number?: number;
  prState: PrState;
  ciState: CiState;
};

export type NotionCard = LinkCardBase & { kind: "notion" };
export type FigmaCard = LinkCardBase & { kind: "figma" };
export type ObsidianCard = LinkCardBase & { kind: "obsidian" };

export type NoteCard =
  | TextCard
  | LinkCard
  | JiraCard
  | GithubPrCard
  | NotionCard
  | FigmaCard
  | ObsidianCard;

/** A card kind backed by a URL (everything except free text). */
export type LinkNoteCard = Exclude<NoteCard, TextCard>;

const LINK_KINDS: readonly NoteCardKind[] = [
  "link",
  "jira",
  "github-pr",
  "notion",
  "figma",
  "obsidian",
];

// ---------------------------------------------------------------------------
// URL parsing / provider detection
// ---------------------------------------------------------------------------

function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

const GITHUB_PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;
const JIRA_KEY = /[A-Z][A-Z0-9]+-\d+/;

export type GithubPrRef = { owner: string; repo: string; number: number };

/** Parse a GitHub PR URL into its {owner, repo, number}. Returns null when the
 *  URL is not a `github.com/{owner}/{repo}/pull/{n}` reference. */
export function parseGithubPrUrl(raw: string): GithubPrRef | null {
  const url = safeParseUrl(raw);
  if (!url) return null;
  if (!hostMatches(url.hostname, "github.com")) return null;
  const m = GITHUB_PR_PATH.exec(url.pathname);
  if (!m) return null;
  const number = Number.parseInt(m[3], 10);
  if (!Number.isFinite(number)) return null;
  return { owner: m[1], repo: m[2], number };
}

/** Extract a Jira issue key (e.g. `PROJ-123`) from a `/browse/KEY` URL. */
export function parseJiraIssueKey(raw: string): string | null {
  const url = safeParseUrl(raw);
  if (!url) return null;
  const idx = url.pathname.indexOf("/browse/");
  if (idx === -1) return null;
  const tail = url.pathname.slice(idx + "/browse/".length);
  const m = JIRA_KEY.exec(tail);
  return m ? m[0] : null;
}

/** Classify a URL into a known provider, or `generic`. */
export function detectProvider(raw: string): NoteProvider {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith("obsidian://")) return "obsidian";
  const url = safeParseUrl(trimmed);
  if (!url) return "generic";
  const host = url.hostname;
  if (hostMatches(host, "figma.com")) return "figma";
  if (hostMatches(host, "notion.so") || hostMatches(host, "notion.site")) {
    return "notion";
  }
  if (hostMatches(host, "atlassian.net") && parseJiraIssueKey(trimmed)) {
    return "jira";
  }
  if (parseGithubPrUrl(trimmed)) return "github-pr";
  return "generic";
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let idCounter = 0;

/** Collision-resistant, sortable-ish id. Not security sensitive. */
export function newNoteId(): string {
  idCounter = (idCounter + 1) % 0xffff;
  return `nc-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function timestamps(now = Date.now()): {
  id: string;
  createdAt: number;
  updatedAt: number;
} {
  return { id: newNoteId(), createdAt: now, updatedAt: now };
}

export function createTextCard(body: string, title?: string): TextCard {
  return {
    ...timestamps(),
    kind: "text",
    body,
    ...(title !== undefined && title !== "" ? { title } : {}),
  };
}

/** Build the best-fit card for a URL by detecting its provider. */
export function createCardFromUrl(rawUrl: string, title?: string): NoteCard {
  const url = rawUrl.trim();
  const base = {
    ...timestamps(),
    url,
    ...(title !== undefined && title !== "" ? { title } : {}),
  };
  const provider = detectProvider(url);
  switch (provider) {
    case "github-pr": {
      const ref = parseGithubPrUrl(url);
      return {
        ...base,
        kind: "github-pr",
        ...(ref ? { owner: ref.owner, repo: ref.repo, number: ref.number } : {}),
        prState: "unknown",
        ciState: "none",
      };
    }
    case "jira": {
      const key = parseJiraIssueKey(url);
      return {
        ...base,
        kind: "jira",
        ...(key ? { issueKey: key } : {}),
        status: "unknown",
      };
    }
    case "notion":
      return { ...base, kind: "notion" };
    case "figma":
      return { ...base, kind: "figma" };
    case "obsidian":
      return { ...base, kind: "obsidian" };
    default:
      return { ...base, kind: "link" };
  }
}

// ---------------------------------------------------------------------------
// Validation (hydration-safe)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function hasBaseShape(v: Record<string, unknown>): boolean {
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number"
  );
}

/** Structural validator used during hydration of persisted/untrusted data.
 *  Rejects unknown kinds and missing required fields. */
export function isNoteCard(value: unknown): value is NoteCard {
  if (!isRecord(value)) return false;
  if (!hasBaseShape(value)) return false;
  const kind = value.kind;
  if (typeof kind !== "string") return false;
  if (kind === "text") {
    return typeof value.body === "string";
  }
  if (!LINK_KINDS.includes(kind as NoteCardKind)) return false;
  if (typeof value.url !== "string" || value.url.length === 0) return false;
  if (kind === "github-pr") {
    return (
      PR_STATES.includes(value.prState as PrState) &&
      CI_STATES.includes(value.ciState as CiState)
    );
  }
  if (kind === "jira") {
    return JIRA_STATUS_CATEGORIES.includes(value.status as JiraStatusCategory);
  }
  return true;
}
