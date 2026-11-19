import { cn } from "@/lib/utils";
import { type LibraryEntry, readerNative } from "@/modules/reader/lib/native";
import { deleteReaderDocs } from "@/modules/reader/lib/player";
import { useReaderStore } from "@/modules/reader/store/readerStore";
import {
  Delete02Icon,
  Link01Icon,
  Unlink01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export type OriginTab = { id: number; label: string };

type Props = {
  /** The reading shown where the library opened from, marked in the list. */
  currentDocId: string | null;
  /** The open tab a reading was made in, if it is still open. */
  originTab: (originKey: string | null) => OriginTab | null;
  onPick: (entry: LibraryEntry) => void;
  /** After readings were deleted, so their panels and tabs can let go. */
  onDeleted: (ids: string[]) => void;
  className?: string;
};

const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

export function formatAge(ms: number, now = Date.now()): string {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(ms).toLocaleDateString();
}

function progressOf(entry: LibraryEntry): number | null {
  if (!entry.wordCount || entry.lastWordIndex === null) return null;
  // The last word read, not the next one: a reading not started shows 0%.
  return Math.min(
    100,
    Math.round((entry.lastWordIndex / Math.max(1, entry.wordCount - 1)) * 100),
  );
}

/**
 * Every reading made so far, newest first. Picking one opens it; the chain
 * button decides whether that goes back to the tab it was made in or stays
 * on the tab on screen.
 */
export function ReaderLibrary({
  currentDocId,
  originTab,
  onPick,
  onDeleted,
  className,
}: Props) {
  const followOrigin = useReaderStore((s) => s.followOrigin);
  const setFollowOrigin = useReaderStore((s) => s.setFollowOrigin);
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setEntries(await readerNative.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await deleteReaderDocs(ids);
      onDeleted(ids);
      toast.message(
        ids.length === 1 ? "Reading deleted" : `${ids.length} readings deleted`,
        { duration: 2000 },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setConfirmAll(false);
      void reload();
    }
  };

  const count = entries?.length ?? 0;

  return (
    <div className={cn("flex min-h-0 flex-col gap-1 text-[12px]", className)}>
      <div className="flex shrink-0 items-center gap-1 px-1">
        <span className="font-medium text-foreground">Readings</span>
        <span className="text-muted-foreground tabular-nums">{count}</span>
        <span className="flex-1" />
        <button
          type="button"
          className={cn(
            ICON_BUTTON,
            followOrigin && "bg-accent text-foreground",
          )}
          aria-pressed={followOrigin}
          title={
            followOrigin
              ? "On: a reading opens in the tab it was made in"
              : "Off: a reading opens here, without switching tabs"
          }
          onClick={() => setFollowOrigin(!followOrigin)}
        >
          <HugeiconsIcon
            icon={followOrigin ? Link01Icon : Unlink01Icon}
            size={14}
          />
        </button>
        {confirmAll ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              disabled={busy}
              className="h-7 rounded-md bg-destructive px-2 text-[12px] text-white hover:bg-destructive/90 disabled:opacity-50"
              onClick={() => void remove((entries ?? []).map((e) => e.id))}
            >
              Delete {count}
            </button>
            <button
              type="button"
              className="h-7 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setConfirmAll(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={count === 0 || busy}
            className="h-7 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            onClick={() => setConfirmAll(true)}
          >
            Delete all
          </button>
        )}
      </div>
      {error ? (
        <div className="px-2 py-3 text-muted-foreground">
          The library could not be read: {error}
        </div>
      ) : entries === null ? (
        <div className="px-2 py-3 text-muted-foreground">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="px-2 py-3 text-muted-foreground">
          No readings yet. Right-click a selection and choose Read here, or run{" "}
          <code className="font-mono">terax-read</code> in a terminal.
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {entries.map((entry) => {
            const origin = originTab(entry.originKey);
            const progress = progressOf(entry);
            const current = entry.id === currentDocId;
            return (
              <li key={entry.id} className="group relative">
                <button
                  type="button"
                  className={cn(
                    "flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 pr-9 text-left hover:bg-accent",
                    current && "bg-accent/60",
                  )}
                  onClick={() => onPick(entry)}
                  title={
                    followOrigin && origin
                      ? `Open in ${origin.label}`
                      : "Open here"
                  }
                >
                  <span className="truncate font-medium text-foreground">
                    {entry.title ?? entry.id}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    {entry.originLabel ? (
                      <span
                        className={cn(
                          "flex min-w-0 items-center gap-1",
                          !origin && "opacity-60",
                        )}
                        title={
                          origin
                            ? `Made in ${origin.label}`
                            : "The tab it was made in is closed"
                        }
                      >
                        <HugeiconsIcon
                          icon={origin ? Link01Icon : Unlink01Icon}
                          size={11}
                        />
                        <span className="truncate">
                          {origin?.label ?? entry.originLabel}
                        </span>
                      </span>
                    ) : null}
                    {entry.wordCount ? (
                      <span className="shrink-0 tabular-nums">
                        {entry.wordCount.toLocaleString()} words
                        {progress !== null ? `, ${progress}%` : ""}
                      </span>
                    ) : null}
                    <span className="shrink-0">
                      {formatAge(entry.updatedAtMs)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={cn(
                    ICON_BUTTON,
                    "absolute top-1.5 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                  title="Delete this reading and its audio"
                  aria-label={`Delete ${entry.title ?? entry.id}`}
                  onClick={() => void remove([entry.id])}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
