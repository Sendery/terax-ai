import type { Tab } from "@/modules/tabs";

/** Why reading aloud is off in a private terminal, said wherever it is asked. */
export const PRIVATE_READ_REASON = "Private terminal: reading aloud is off";
export const NOTHING_TO_READ_REASON = "Nothing to read in this tab";
export const READER_TAB_REASON = "Already in a Reader tab";

/**
 * Why a tab cannot give Read here anything, or null when it can: a terminal
 * gives its selection, an editor or a Markdown view its selection or the
 * whole document. Everything else has no text to offer.
 */
export function readHereReason(tab: Tab | undefined): string | null {
  if (!tab) return NOTHING_TO_READ_REASON;
  if (tab.kind === "terminal") return tab.private ? PRIVATE_READ_REASON : null;
  if (tab.kind === "editor" || tab.kind === "markdown") return null;
  if (tab.kind === "reader") return READER_TAB_REASON;
  return NOTHING_TO_READ_REASON;
}

/** Speaking a selection: the same, except a Reader tab is no exception. */
export function speakReason(tab: Tab | undefined): string | null {
  const reason = readHereReason(tab);
  return reason === READER_TAB_REASON ? NOTHING_TO_READ_REASON : reason;
}

/** True when the tab reads its whole document with nothing selected. */
export function readsWholeDocument(tab: Tab | undefined): boolean {
  return tab?.kind === "editor" || tab?.kind === "markdown";
}

/**
 * Where a reading goes when it has to land in a panel: the tab it was made
 * in while that tab is open and the chain is on, else the tab asked for when
 * it can hold a panel, else the last tab with content that was on screen.
 */
export function dockTarget(args: {
  tabs: readonly Tab[];
  origin: number | null;
  preferred: number | null;
  lastContent: number | null;
}): number | null {
  const canHold = (id: number | null): id is number =>
    id !== null && args.tabs.some((t) => t.id === id && t.kind !== "reader");
  if (canHold(args.origin)) return args.origin;
  if (canHold(args.preferred)) return args.preferred;
  if (canHold(args.lastContent)) return args.lastContent;
  return args.tabs.find((t) => t.kind !== "reader")?.id ?? null;
}
