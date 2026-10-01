import {
  isLeaf,
  type PaneId,
  type PaneNode,
} from "@/modules/terminal/lib/panes";

import type { SessionCandidate } from "./pickSession";

/** The parts of a terminal tab the history panel needs to find transcripts. */
export type TerminalSourceTab = {
  id: number;
  title: string;
  cwd: string | null;
  activeLeafId: PaneId;
  paneTree: PaneNode;
};

/** One terminal pane the panel can bind to. */
export type TerminalSource = {
  tabId: number;
  leafId: PaneId;
  tabTitle: string;
  cwd: string;
  /** Position within its tab, so a split can be labelled unambiguously. */
  paneIndex: number;
  paneCount: number;
};

export type TerminalBinding = {
  tabId: number;
  leafId: PaneId;
  tabTitle: string;
  cwd: string;
};

function leaves(node: PaneNode): Extract<PaneNode, { kind: "leaf" }>[] {
  return isLeaf(node) ? [node] : node.children.flatMap(leaves);
}

/**
 * Every terminal pane that currently has a directory.
 *
 * A pane that has not reported its cwd yet inherits the tab's, which is where
 * it was spawned. A pane with neither is dropped: a transcript is resolved from
 * a directory, so there is nothing to look up.
 */
export function collectTerminalSources(
  tabs: readonly TerminalSourceTab[],
): TerminalSource[] {
  return tabs.flatMap((tab) => {
    const panes = leaves(tab.paneTree);
    return panes.flatMap((pane, paneIndex) => {
      const cwd = pane.cwd ?? tab.cwd;
      if (!cwd) return [];
      return [
        {
          tabId: tab.id,
          leafId: pane.id,
          tabTitle: tab.title,
          cwd,
          paneIndex,
          paneCount: panes.length,
        },
      ];
    });
  });
}

function sameBinding(a: TerminalBinding, b: TerminalBinding): boolean {
  return (
    a.tabId === b.tabId &&
    a.leafId === b.leafId &&
    a.cwd === b.cwd &&
    a.tabTitle === b.tabTitle
  );
}

/**
 * Which terminal the history panel follows.
 *
 * The panel tracks the focused terminal, but focus moves to editors, diagrams
 * and diff tabs all the time and none of those own a transcript. Dropping the
 * binding then would blank the panel mid-read, so the last terminal is held
 * until it is closed.
 *
 * Returns the previous object unchanged when nothing moved, because the
 * binding drives a filesystem probe.
 */
export function nextTerminalBinding(
  previous: TerminalBinding | null,
  focused: TerminalBinding | null,
  openTerminalTabIds: readonly number[],
): TerminalBinding | null {
  if (focused) {
    return previous && sameBinding(previous, focused) ? previous : focused;
  }
  if (!previous) return null;
  return openTerminalTabIds.includes(previous.tabId) ? previous : null;
}

/** A terminal pane together with the transcripts found in its directory. */
export type SessionSourceGroup = TerminalSource & {
  /** Stable identity for list rendering and selection. */
  key: string;
  label: string;
  sessions: SessionCandidate[];
};

export function terminalSourceKey(source: TerminalSource): string {
  return `${source.tabId}:${source.leafId}`;
}

/**
 * Pairs every open terminal pane with its transcripts.
 *
 * Panes with no transcript are kept: the picker should show that a terminal
 * exists and has no history, rather than hiding it and looking incomplete.
 */
export function buildSessionGroups(
  sources: readonly TerminalSource[],
  sessionsByCwd: ReadonlyMap<string, readonly SessionCandidate[]>,
): SessionSourceGroup[] {
  return sources.map((source) => ({
    ...source,
    key: terminalSourceKey(source),
    label:
      source.paneCount > 1
        ? `${source.tabTitle} · pane ${source.paneIndex + 1}`
        : source.tabTitle,
    sessions: [...(sessionsByCwd.get(source.cwd) ?? [])].sort(
      (a, b) => b.modifiedMs - a.modifiedMs,
    ),
  }));
}
