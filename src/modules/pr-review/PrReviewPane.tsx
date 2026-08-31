import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  native,
  type GitBranchList,
  type GitCommitFileChange,
  type GitLogEntry,
  type GitRangeFile,
  type GitRangeSummary,
} from "@/modules/ai/lib/native";
import {
  ArrowDown01Icon,
  GitBranchIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PrReviewDiff,
  PrReviewDiffLoading,
  usePrReviewThemeExt,
} from "./PrReviewDiff";
import {
  DEFAULT_DIFF_PREFS,
  type DiffContext,
  type DiffLayout,
  type DiffViewPrefs,
} from "./lib/diffView";
import {
  basePointsAtRemote,
  fileDiffRequest,
  nextScopeAfterCommits,
  type ReviewScope,
} from "./lib/reviewScope";

type Props = {
  repoRoot: string;
  head: string;
  base: string;
  onBaseChange: (base: string) => void;
};

type DiffState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      originalContent: string;
      modifiedContent: string;
      isBinary: boolean;
      fallbackPatch: string;
    }
  | { kind: "error"; message: string };

function statusTone(status: string): string {
  switch (status.toUpperCase()) {
    case "A":
      return "text-emerald-600 dark:text-emerald-400";
    case "D":
      return "text-rose-600 dark:text-rose-400";
    case "R":
    case "C":
      return "text-violet-600 dark:text-violet-400";
    default:
      return "text-amber-600 dark:text-amber-400";
  }
}

function fileName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function dirName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** The commit-scoped file list, shaped like the branch-scoped one. */
function asRangeFiles(files: GitCommitFileChange[]): GitRangeFile[] {
  return files.map((f) => ({
    path: f.path,
    originalPath: f.originalPath,
    status: f.status,
    statusLabel: f.statusLabel,
    added: f.added,
    removed: f.removed,
    isBinary: f.isBinary,
  }));
}

export function PrReviewPane({ repoRoot, head, base, onBaseChange }: Props) {
  const themeExt = usePrReviewThemeExt();

  const [branches, setBranches] = useState<GitBranchList | null>(null);
  const [summary, setSummary] = useState<GitRangeSummary | null>(null);
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [scope, setScope] = useState<ReviewScope>({ kind: "branch" });
  const [scopeFiles, setScopeFiles] = useState<GitRangeFile[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffState>({ kind: "idle" });
  const [prefs, setPrefs] = useState<DiffViewPrefs>(DEFAULT_DIFF_PREFS);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"fetching" | "reading">("reading");
  /** Why the remote could not be reached, when it could not be. */
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The range and its commits are one unit: the file list, the commit list and
  // the scope all have to agree about which revisions are in play. Loading is a
  // callback rather than an effect body so the refresh button can run the same
  // path without a token whose only job is to invalidate a dependency list.
  const loadRange = useCallback(
    async (signal: { cancelled: boolean }) => {
      setLoading(true);
      setError(null);
      setFetchNote(null);
      try {
        // The ref list comes first because it settles whether the base is a
        // remote-tracking branch, and so whether the comparison would be
        // against a stale copy of it.
        const list = await native.gitBranches(repoRoot);
        if (signal.cancelled) return;
        setBranches(list);

        if (basePointsAtRemote(base, list.remote)) {
          setPhase("fetching");
          try {
            await native.gitFetch(repoRoot);
          } catch (cause) {
            // Offline is not a reason to refuse the review: it just means the
            // base is as the last fetch left it, and saying so beats a diff
            // that quietly compares against something older than it looks.
            if (!signal.cancelled) {
              setFetchNote(
                cause instanceof Error ? cause.message : String(cause),
              );
            }
          }
          if (signal.cancelled) return;
        }
        setPhase("reading");

        const next = await native.gitRangeSummary(repoRoot, base, head);
        const log = await native.gitLog(repoRoot, { limit: 200 });
        if (signal.cancelled) return;
        const inRange: GitLogEntry[] = [];
        for (const commit of log) {
          if (commit.sha === next.mergeBase) break;
          inRange.push(commit);
        }
        setSummary(next);
        setCommits(inRange);
        setScope((current) =>
          nextScopeAfterCommits(
            current,
            inRange.map((c) => c.sha),
          ),
        );
      } catch (cause) {
        if (signal.cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setSummary(null);
        setCommits([]);
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    },
    [repoRoot, base, head],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void loadRange(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadRange]);

  // Files follow the scope: the whole branch, or just what one commit touched.
  useEffect(() => {
    let cancelled = false;
    if (scope.kind === "branch") {
      setScopeFiles(summary?.files ?? null);
      return;
    }
    setScopeFiles(null);
    void native
      .gitCommitFiles(repoRoot, scope.sha)
      .then((files) => {
        if (!cancelled) setScopeFiles(asRangeFiles(files));
      })
      .catch(() => {
        if (!cancelled) setScopeFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repoRoot, scope, summary]);

  // Keep a selection that still exists, so switching scope lands somewhere.
  useEffect(() => {
    if (!scopeFiles) return;
    setSelectedPath((current) =>
      current && scopeFiles.some((f) => f.path === current)
        ? current
        : (scopeFiles[0]?.path ?? null),
    );
  }, [scopeFiles]);

  const selected = useMemo(
    () => scopeFiles?.find((f) => f.path === selectedPath) ?? null,
    [scopeFiles, selectedPath],
  );

  useEffect(() => {
    if (!selected || !summary) {
      setDiff({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setDiff({ kind: "loading" });
    const request = fileDiffRequest(scope, selected, {
      mergeBase: summary.mergeBase,
      head: summary.head,
    });
    const load =
      request.kind === "range"
        ? native.gitRangeFileDiff({
            repoRoot,
            baseRev: request.baseRev,
            headRev: request.headRev,
            path: request.path,
            originalPath: request.originalPath,
          })
        : native.gitCommitFileDiff(
            repoRoot,
            request.sha,
            request.path,
            request.originalPath,
          );
    void load
      .then((result) => {
        if (cancelled) return;
        setDiff({
          kind: "loaded",
          originalContent: result.originalContent,
          modifiedContent: result.modifiedContent,
          isBinary: result.isBinary,
          fallbackPatch: result.fallbackPatch,
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        setDiff({
          kind: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [repoRoot, scope, selected, summary]);

  const refresh = useCallback(() => {
    void loadRange({ cancelled: false });
  }, [loadRange]);

  const baseOptions = useMemo(() => {
    if (!branches) return [] as string[];
    return [...branches.remote, ...branches.local].filter((b) => b !== head);
  }, [branches, head]);

  const totals = useMemo(() => {
    const files = scopeFiles ?? [];
    return files.reduce(
      (acc, f) => ({
        added: acc.added + f.added,
        removed: acc.removed + f.removed,
      }),
      { added: 0, removed: 0 },
    );
  }, [scopeFiles]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-xs">
        <HugeiconsIcon
          icon={GitBranchIcon}
          size={13}
          strokeWidth={1.75}
          className="shrink-0 text-muted-foreground"
        />
        <span className="shrink-0 font-medium">Review</span>
        <span className="truncate font-mono text-[11px] text-foreground">
          {head}
        </span>
        <span className="shrink-0 text-muted-foreground">into</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="xs"
              variant="ghost"
              className="h-6 shrink-0 gap-1 px-1.5 font-mono text-[11px]"
              aria-label={`Compare against ${base}, choose another branch`}
            >
              {base}
              <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={2} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="max-h-[60vh] w-72 overflow-y-auto p-1"
          >
            {baseOptions.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                No other branch to compare against.
              </p>
            ) : (
              baseOptions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onBaseChange(name)}
                  aria-current={name === base ? "true" : undefined}
                  className={cn(
                    "flex w-full cursor-pointer items-center rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-accent",
                    name === base && "bg-accent/60 text-foreground",
                  )}
                >
                  {name}
                </button>
              ))
            )}
          </PopoverContent>
        </Popover>

        {fetchNote ? (
          <span
            className="shrink-0 text-[10.5px] text-amber-600 dark:text-amber-400"
            title={`Could not reach the remote: ${fetchNote}`}
          >
            offline
          </span>
        ) : null}

        {summary ? (
          <span className="shrink-0 tabular-nums text-[10.5px] text-muted-foreground">
            {summary.ahead} ahead
            {summary.behind > 0 ? `, ${summary.behind} behind` : ""}
          </span>
        ) : null}

        <span className="flex-1" />

        <fieldset
          className="m-0 flex shrink-0 rounded-md border-0 bg-muted/50 p-0.5"
          aria-label="Diff layout"
        >
          {(["unified", "split"] as DiffLayout[]).map((layout) => (
            <button
              key={layout}
              type="button"
              aria-pressed={prefs.layout === layout}
              onClick={() => setPrefs((p) => ({ ...p, layout }))}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors",
                prefs.layout === layout
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {layout === "split" ? "Side by side" : "Unified"}
            </button>
          ))}
        </fieldset>

        <fieldset
          className="m-0 flex shrink-0 rounded-md border-0 bg-muted/50 p-0.5"
          aria-label="Diff context"
        >
          {(["changes", "full"] as DiffContext[]).map((context) => (
            <button
              key={context}
              type="button"
              aria-pressed={prefs.context === context}
              onClick={() => setPrefs((p) => ({ ...p, context }))}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                prefs.context === context
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {context === "changes" ? "Changes" : "Whole file"}
            </button>
          ))}
        </fieldset>

        <Button
          size="icon"
          variant="ghost"
          className="size-6 shrink-0"
          onClick={refresh}
          aria-label="Reload the review"
        >
          <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.9} />
        </Button>
      </header>

      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-[13px] font-medium">Could not build the review</p>
          <p className="max-w-md text-[11px] text-muted-foreground">{error}</p>
          <Button size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside
            className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border/50"
            aria-label="Review contents"
          >
            {/* Two independently scrolling lists. A long branch has hundreds of
                commits, and letting them share one scroller buries the files,
                which are what a review actually works through. */}
            <div className="flex max-h-[40%] min-h-24 shrink-0 flex-col overflow-y-auto border-b border-border/50">
              <div className="px-2 pt-2 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                Scope
              </div>
              <button
                type="button"
                onClick={() => setScope({ kind: "branch" })}
                aria-current={scope.kind === "branch" ? "true" : undefined}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1.5 text-left text-[11.5px] hover:bg-accent",
                  scope.kind === "branch" && "bg-accent/60 font-medium",
                )}
              >
                <span>Whole branch</span>
                <span className="tabular-nums text-[10px] text-muted-foreground">
                  {summary?.files.length ?? 0} files
                </span>
              </button>
              {commits.map((commit) => (
                <button
                  key={commit.sha}
                  type="button"
                  onClick={() => setScope({ kind: "commit", sha: commit.sha })}
                  aria-current={
                    scope.kind === "commit" && scope.sha === commit.sha
                      ? "true"
                      : undefined
                  }
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left hover:bg-accent",
                    scope.kind === "commit" &&
                      scope.sha === commit.sha &&
                      "bg-accent/60",
                  )}
                >
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {commit.shortSha}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">
                    {commit.subject || "(no subject)"}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-baseline justify-between px-2 pt-2 pb-1">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                Files
              </span>
              <span className="font-mono text-[10px] tabular-nums">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{totals.added}
                </span>{" "}
                <span className="text-rose-600 dark:text-rose-400">
                  −{totals.removed}
                </span>
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && !scopeFiles ? (
                <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
                  <Spinner className="size-3" />
                  {phase === "fetching"
                    ? "Fetching the base…"
                    : "Reading the branch…"}
                </div>
              ) : (scopeFiles?.length ?? 0) === 0 ? (
                <p className="px-2 py-3 text-[11px] text-muted-foreground">
                  No files changed here.
                </p>
              ) : (
                scopeFiles?.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    aria-current={
                      file.path === selectedPath ? "true" : undefined
                    }
                    title={
                      file.originalPath
                        ? `${file.statusLabel}: ${file.originalPath} → ${file.path}`
                        : `${file.statusLabel}: ${file.path}`
                    }
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left hover:bg-accent",
                      file.path === selectedPath && "bg-accent/60",
                    )}
                  >
                    <span
                      className={cn(
                        "w-3 shrink-0 font-mono text-[10px] font-bold",
                        statusTone(file.status),
                      )}
                    >
                      {file.status.charAt(0)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[11.5px] leading-tight">
                        {fileName(file.path)}
                      </span>
                      {dirName(file.path) ? (
                        <span className="truncate text-[9.5px] leading-tight text-muted-foreground">
                          {dirName(file.path)}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-muted-foreground">
                      {file.isBinary
                        ? "bin"
                        : `+${file.added} −${file.removed}`}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            aria-label="File diff"
          >
            {selected ? (
              <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border/50 px-3 text-[11px]">
                <span
                  className={cn(
                    "font-mono font-bold",
                    statusTone(selected.status),
                  )}
                >
                  {selected.status.charAt(0)}
                </span>
                <span className="truncate font-mono text-muted-foreground">
                  {selected.originalPath
                    ? `${selected.originalPath} → ${selected.path}`
                    : selected.path}
                </span>
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              {diff.kind === "loading" ? (
                <PrReviewDiffLoading />
              ) : diff.kind === "error" ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {diff.message}
                </p>
              ) : diff.kind === "loaded" && selected ? (
                <PrReviewDiff
                  key={`${selected.path}:${prefs.layout}:${prefs.context}`}
                  path={selected.path}
                  originalContent={diff.originalContent}
                  modifiedContent={diff.modifiedContent}
                  isBinary={diff.isBinary}
                  fallbackPatch={diff.fallbackPatch}
                  prefs={prefs}
                  themeExt={themeExt}
                />
              ) : (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  Select a file to review it.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
