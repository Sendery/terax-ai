export type FileLinkStat = {
  kind: "file" | "dir" | "symlink";
};

export type TerminalFileLink = {
  text: string;
  path: string;
  start: number;
  end: number;
};

export type ResolveTerminalFileLinksOptions = {
  line: string;
  cwd: string | null | undefined;
  home: string | null | undefined;
  stat: (path: string) => Promise<FileLinkStat | null>;
  maxCandidates?: number;
};

type Candidate = {
  text: string;
  start: number;
  end: number;
};

const MAX_LINE_LENGTH = 2_000;
const MAX_CANDIDATES = 32;
const MAX_PATH_LENGTH = 512;
const UNQUOTED_TOKEN_RE = /(?:\\\s|[^\s<>"'`|;&])+/g;
const QUOTED_TOKEN_RE = /(["'])(.*?)\1/g;

export async function resolveTerminalFileLinks({
  line,
  cwd,
  home,
  stat,
  maxCandidates = MAX_CANDIDATES,
}: ResolveTerminalFileLinksOptions): Promise<TerminalFileLink[]> {
  if (!line || line.length > MAX_LINE_LENGTH) return [];
  const links: TerminalFileLink[] = [];
  const seenPaths = new Set<string>();
  const candidates = extractPathCandidates(line).slice(0, maxCandidates);

  for (const candidate of candidates) {
    const path = resolveCandidatePath(candidate.text, cwd, home);
    if (!path || seenPaths.has(path)) continue;
    seenPaths.add(path);
    const result = await stat(path);
    if (result?.kind !== "file") continue;
    links.push({
      text: candidate.text,
      path,
      start: candidate.start,
      end: candidate.end,
    });
  }

  return links;
}

export function extractPathCandidates(line: string): Candidate[] {
  const candidates: Candidate[] = [];
  const occupied: Array<[number, number]> = [];

  for (const match of line.matchAll(QUOTED_TOKEN_RE)) {
    const raw = match[2];
    const fullStart = match.index ?? 0;
    const start = fullStart + 1;
    const candidate = cleanToken(raw, start);
    if (!candidate) continue;
    candidates.push(candidate);
    occupied.push([fullStart, fullStart + match[0].length]);
  }

  for (const match of line.matchAll(UNQUOTED_TOKEN_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (occupied.some(([a, b]) => start < b && end > a)) continue;
    const candidate = cleanToken(raw, start);
    if (!candidate) continue;
    candidates.push(candidate);
  }

  return candidates
    .sort((a, b) => a.start - b.start)
    .filter((candidate, index, all) => {
      const prev = all[index - 1];
      return !prev || candidate.start >= prev.end;
    });
}

export function resolveCandidatePath(
  text: string,
  cwd: string | null | undefined,
  home: string | null | undefined,
): string | null {
  if (!isEligiblePathText(text)) return null;

  const unescaped = text.replace(/\\ /g, " ");
  if (unescaped.startsWith("~/")) {
    if (!home) return null;
    return normalizePath(`${home.replace(/\\/g, "/")}/${unescaped.slice(2)}`);
  }
  if (isAbsolutePath(unescaped)) return normalizePath(unescaped);
  if (!cwd) return null;
  return normalizePath(`${cwd.replace(/\\/g, "/")}/${unescaped}`);
}

function cleanToken(raw: string, offset: number): Candidate | null {
  let start = 0;
  let end = raw.length;
  while (start < end && isLeadingPathBoundary(raw[start])) start++;
  while (end > start && isTrailingPathBoundary(raw[end - 1])) end--;
  if (start >= end) return null;

  let text = raw.slice(start, end);
  let adjustedEnd = end;
  const location = text.match(/^(.*?)(?::\d+){1,2}$/);
  if (location?.[1] && !/^[A-Za-z]$/.test(location[1])) {
    adjustedEnd = start + location[1].length;
    text = location[1];
  }

  if (!isEligiblePathText(text)) return null;
  return {
    text,
    start: offset + start,
    end: offset + adjustedEnd,
  };
}

function isEligiblePathText(text: string): boolean {
  if (!text || text.length > MAX_PATH_LENGTH) return false;
  if (text === "." || text === "..") return false;
  if (text.startsWith("-")) return false;
  if (/[\0{}$]/.test(text)) return false;
  return /[A-Za-z0-9_.~\/\\-]/.test(text);
}

function isLeadingPathBoundary(ch: string): boolean {
  return ch === "(" || ch === "[" || ch === "{" || ch === "<";
}

function isTrailingPathBoundary(ch: string): boolean {
  return (
    isLeadingPathBoundary(ch) ||
    ch === "," ||
    ch === ":" ||
    ch === ";" ||
    ch === "!" ||
    ch === "?" ||
    ch === ")" ||
    ch === "]" ||
    ch === "}" ||
    ch === ">" ||
    ch === "."
  );
}

function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("//") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

function normalizePath(path: string): string {
  const forward = path.replace(/\\/g, "/");
  const drive = forward.match(/^([A-Za-z]:)(?:\/|$)/);
  const absolute = forward.startsWith("/");
  const prefix = drive ? `${drive[1]}/` : absolute ? "/" : "";
  const rest = drive
    ? forward.slice(prefix.length)
    : absolute
      ? forward.slice(1)
      : forward;
  const parts: string[] = [];

  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0) parts.pop();
      else if (!prefix) parts.push(part);
      continue;
    }
    parts.push(part);
  }

  return `${prefix}${parts.join("/")}` || (absolute ? "/" : ".");
}
