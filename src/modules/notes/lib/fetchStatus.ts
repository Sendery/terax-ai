/**
 * Live status fetch (integration seam). Reads optional credentials from the
 * keychain and calls provider REST APIs through the Rust HTTP proxy, then maps
 * responses via the pure liveStatus parsers. Every failure degrades to an empty
 * patch, so the card keeps its last (or fallback) state — never throws.
 *
 * Credentials (optional, via the OS keychain, service "terax.notes"):
 *   - account "github.token"      -> a GitHub token (public repos work without)
 *   - account "jira:<host>"       -> "email:api_token" for that Jira site
 */
import { invoke } from "@tauri-apps/api/core";
import { proxyFetch } from "@/modules/ai/lib/proxyFetch";
import type { GithubPrCard, JiraCard, NoteCard } from "./cards";
import type { NoteCardPatch } from "./collection";
import {
  githubPrApiUrl,
  githubStatusApiUrl,
  jiraIssueApiUrl,
  parseGithubCombinedStatus,
  parseGithubPrResponse,
  parseJiraStatusResponse,
} from "./liveStatus";

const NOTES_SECRET_SERVICE = "terax.notes";

async function getSecret(account: string): Promise<string | null> {
  try {
    return await invoke<string | null>("secrets_get", {
      service: NOTES_SECRET_SERVICE,
      account,
    });
  } catch {
    return null;
  }
}

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<unknown | null> {
  try {
    const res = await proxyFetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchGithubPrStatus(
  card: GithubPrCard,
): Promise<NoteCardPatch> {
  if (!card.owner || !card.repo || typeof card.number !== "number") return {};
  const ref = { owner: card.owner, repo: card.repo, number: card.number };
  const token = await getSecret("github.token");
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "terax-notes",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const prJson = await getJson(githubPrApiUrl(ref), headers);
  if (!prJson) return {};
  const { prState, headSha } = parseGithubPrResponse(prJson);
  const patch: NoteCardPatch = { prState };
  if (headSha) {
    const statusJson = await getJson(githubStatusApiUrl(ref, headSha), headers);
    patch.ciState = parseGithubCombinedStatus(statusJson);
  }
  return patch;
}

export async function fetchJiraStatus(card: JiraCard): Promise<NoteCardPatch> {
  if (!card.issueKey) return {};
  const apiUrl = jiraIssueApiUrl(card.url, card.issueKey);
  if (!apiUrl) return {};
  let host: string;
  try {
    host = new URL(card.url).host;
  } catch {
    return {};
  }
  const cred = await getSecret(`jira:${host}`); // "email:api_token"
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cred) headers.Authorization = `Basic ${btoa(cred)}`;

  const json = await getJson(apiUrl, headers);
  if (!json) return {};
  const { status, statusName } = parseJiraStatusResponse(json);
  const patch: NoteCardPatch = { status };
  if (statusName) patch.statusName = statusName;
  return patch;
}

/** Fetch a live-status patch for a card. Returns {} for non-live kinds or on
 *  any failure. */
export async function fetchCardStatus(card: NoteCard): Promise<NoteCardPatch> {
  if (card.kind === "github-pr") return fetchGithubPrStatus(card);
  if (card.kind === "jira") return fetchJiraStatus(card);
  return {};
}
