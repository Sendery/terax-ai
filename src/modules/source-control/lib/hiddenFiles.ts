/**
 * Per-repository list of paths the user muted in the Source Control panel.
 *
 * This is a view filter, never a git operation: a muted path keeps its real
 * status, stays committable, and is never written to .gitignore. Everything
 * here is pure so the panel hook and the settings store share one contract.
 */

export type HiddenFilesMap = Readonly<Record<string, readonly string[]>>;

/** Bounds the persisted JSON so a runaway repo cannot bloat every app boot. */
export const MAX_HIDDEN_PER_REPO = 1000;

export const EMPTY_HIDDEN_PATHS: ReadonlySet<string> = new Set<string>();

const EMPTY_MAP: HiddenFilesMap = Object.freeze({});

/** Git reports forward slashes; normalize so Windows roots hash identically. */
function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

export function repoKey(repoRoot: string | null | undefined): string {
  if (!repoRoot) return "";
  const normalized = normalizeSeparators(repoRoot).trim();
  if (normalized.length <= 1) return normalized;
  return normalized.replace(/\/+$/, "");
}

export function normalizeHiddenPath(path: string): string {
  return normalizeSeparators(path).trim().replace(/^\/+/, "");
}

/** The store hands back whatever JSON is on disk; accept only what we wrote. */
export function sanitizeHiddenFilesMap(raw: unknown): HiddenFilesMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_MAP;
  const out: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const root = repoKey(key);
    if (!root || !Array.isArray(value)) continue;
    const paths = dedupe(
      value.filter((entry): entry is string => typeof entry === "string"),
    );
    if (paths.length > 0) out[root] = paths;
  }
  return out;
}

export function hiddenPathsFor(
  map: HiddenFilesMap,
  repoRoot: string | null | undefined,
): ReadonlySet<string> {
  const root = repoKey(repoRoot);
  if (!root) return EMPTY_HIDDEN_PATHS;
  const paths = map[root];
  if (!paths || paths.length === 0) return EMPTY_HIDDEN_PATHS;
  return new Set(paths);
}

export function withHiddenPaths(
  map: HiddenFilesMap,
  repoRoot: string | null | undefined,
  paths: readonly string[],
): HiddenFilesMap {
  const root = repoKey(repoRoot);
  if (!root) return map;
  const additions = dedupe(paths);
  if (additions.length === 0) return map;
  const current = map[root] ?? [];
  const next = dedupe([...current, ...additions]);
  if (next.length === current.length) return map;
  return { ...map, [root]: next };
}

export function withoutHiddenPaths(
  map: HiddenFilesMap,
  repoRoot: string | null | undefined,
  paths: readonly string[],
): HiddenFilesMap {
  const root = repoKey(repoRoot);
  if (!root) return map;
  const current = map[root];
  if (!current || current.length === 0) return map;
  const removals = new Set(paths.map(normalizeHiddenPath));
  const next = current.filter((path) => !removals.has(path));
  if (next.length === current.length) return map;
  return omitWhenEmpty(map, root, next);
}

export function clearHiddenPaths(
  map: HiddenFilesMap,
  repoRoot: string | null | undefined,
): HiddenFilesMap {
  const root = repoKey(repoRoot);
  if (!root || !map[root]) return map;
  return omitWhenEmpty(map, root, []);
}

/** Splits changed files into the ones the panel lists and the muted ones. */
export function partitionHidden<T extends { path: string }>(
  entries: readonly T[],
  hidden: ReadonlySet<string>,
): { visible: readonly T[]; hidden: readonly T[] } {
  if (hidden.size === 0) return { visible: entries, hidden: [] };
  const visible: T[] = [];
  const muted: T[] = [];
  for (const entry of entries) {
    if (hidden.has(normalizeHiddenPath(entry.path))) muted.push(entry);
    else visible.push(entry);
  }
  return { visible, hidden: muted };
}

function dedupe(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const path = normalizeHiddenPath(raw);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= MAX_HIDDEN_PER_REPO) break;
  }
  return out;
}

function omitWhenEmpty(
  map: HiddenFilesMap,
  root: string,
  next: readonly string[],
): HiddenFilesMap {
  if (next.length > 0) return { ...map, [root]: next };
  const rest: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key !== root) rest[key] = value;
  }
  return rest;
}
