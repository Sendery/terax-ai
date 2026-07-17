/**
 * Pure mapping between provider REST responses and our card status fields.
 * URL builders + response parsers only. No network, no keychain (those live in
 * fetchStatus). Every parser degrades to the safe fallback (unknown / none) so a
 * malformed or rate-limited response never corrupts a card.
 */
import type { CiState, GithubPrRef, JiraStatusCategory, PrState } from "./cards";

// --- GitHub -----------------------------------------------------------------

export function githubPrApiUrl(ref: GithubPrRef): string {
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
}

export function githubStatusApiUrl(ref: GithubPrRef, sha: string): string {
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${sha}/status`;
}

export type GithubPrStatus = { prState: PrState; headSha: string | null };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export function parseGithubPrResponse(json: unknown): GithubPrStatus {
  const r = asRecord(json);
  if (!r) return { prState: "unknown", headSha: null };
  const head = asRecord(r.head);
  const headSha = head && typeof head.sha === "string" ? head.sha : null;
  let prState: PrState = "unknown";
  if (r.merged === true) prState = "merged";
  else if (r.state === "closed") prState = "closed";
  else if (r.state === "open") prState = r.draft === true ? "draft" : "open";
  return { prState, headSha };
}

export function parseGithubCombinedStatus(json: unknown): CiState {
  const r = asRecord(json);
  if (!r) return "none";
  if (typeof r.total_count === "number" && r.total_count === 0) return "none";
  switch (r.state) {
    case "success":
      return "success";
    case "failure":
      return "failure";
    case "pending":
      return "pending";
    case "error":
      return "error";
    default:
      return "none";
  }
}

// --- Jira --------------------------------------------------------------------

export function jiraOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function jiraIssueApiUrl(url: string, key: string): string | null {
  const origin = jiraOrigin(url);
  if (!origin) return null;
  return `${origin}/rest/api/3/issue/${key}?fields=status`;
}

export type JiraStatus = {
  status: JiraStatusCategory;
  statusName: string | null;
};

function mapJiraCategory(key: unknown): JiraStatusCategory {
  switch (key) {
    case "new":
      return "todo";
    case "indeterminate":
      return "in-progress";
    case "done":
      return "done";
    default:
      return "unknown";
  }
}

export function parseJiraStatusResponse(json: unknown): JiraStatus {
  const r = asRecord(json);
  const fields = r && asRecord(r.fields);
  const status = fields && asRecord(fields.status);
  if (!status) return { status: "unknown", statusName: null };
  const category = asRecord(status.statusCategory);
  return {
    status: mapJiraCategory(category?.key),
    statusName: typeof status.name === "string" ? status.name : null,
  };
}
