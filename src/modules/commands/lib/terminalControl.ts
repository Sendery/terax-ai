import type { Tab } from "@/modules/tabs";
import { findLeafCwd, hasLeaf, leafIds } from "@/modules/terminal/lib/panes";
import {
  type ControlHandlers,
  type SplitDirection,
  TERMINAL_READ_DEFAULT_LINES,
} from "./controlCommands";

type TerminalHandlers = Pick<
  ControlHandlers,
  | "listTerminals"
  | "readTerminal"
  | "openTerminal"
  | "splitTerminal"
  | "focusTerminal"
  | "closeTerminal"
  | "sendToTerminal"
>;

export type TerminalControlDeps = {
  getTabs: () => readonly Tab[];
  getActiveTabId: () => number | null;
  /** The coding agent detected in a pane, if any. */
  getAgent: (leafId: number) => { agent: string; status: string } | undefined;
  /** Redacted scrollback tail, or null when the pane cannot be read. */
  readBuffer: (leafId: number, lines: number) => Promise<string | null>;
  isMounted: (leafId: number) => boolean;
  newTab: (cwd?: string) => number;
  defaultCwd: () => string | undefined;
  focusTab: (tabId: number) => void;
  focusPane: (tabId: number, leafId: number) => void;
  splitActivePane: (tabId: number, dir: "row" | "col") => number | null;
  closePane: (leafId: number) => void;
  setTabTitle: (tabId: number, title: string) => void;
  whenReady: (leafId: number) => Promise<void>;
  write: (leafId: number, data: string) => boolean;
  focusInput: (leafId: number) => void;
  maxPanesPerTab: number;
};

export const TERMINAL_READ_MAX_CHARS = 48_000;
const COMMIT_WAIT_MS = 2000;

function failure(message: string): never {
  throw { code: "command_failed", message };
}

type TerminalTab = Extract<Tab, { kind: "terminal" }>;

function terminalOf(tabs: readonly Tab[], leafId: number): TerminalTab {
  const tab = tabs.find(
    (t): t is TerminalTab => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
  );
  if (!tab) failure(`Terminal pane ${leafId} not found`);
  // A private pane is reported exactly like a missing one would be useful to
  // an attacker; say it is private so the agent stops retrying.
  if (tab.private)
    failure(`Terminal pane ${leafId} is private and is not available to agents`);
  return tab;
}

export type TerminalPaneInfo = {
  leafId: number;
  tabId: number;
  spaceId: string;
  title: string;
  cwd?: string;
  /** The pane with keyboard focus: the active pane of the active tab. */
  focused: boolean;
  /** The pane its tab would focus when shown. */
  activeInTab: boolean;
  /** False for a pane restored from disk that has not started its shell. */
  started: boolean;
  agent?: { name: string; status: string };
};

/** Every pane an agent may see. Private tabs contribute a count and nothing
 *  else: not their titles, directories or pane ids. */
export function listTerminalPanes(
  tabs: readonly Tab[],
  activeTabId: number | null,
  deps: Pick<TerminalControlDeps, "getAgent" | "isMounted">,
): { panes: TerminalPaneInfo[]; privateTerminals: number } {
  const panes: TerminalPaneInfo[] = [];
  let privateTerminals = 0;
  for (const tab of tabs) {
    if (tab.kind !== "terminal") continue;
    if (tab.private) {
      privateTerminals += 1;
      continue;
    }
    for (const leafId of leafIds(tab.paneTree)) {
      const cwd = findLeafCwd(tab.paneTree, leafId) ?? tab.cwd;
      const agent = deps.getAgent(leafId);
      panes.push({
        leafId,
        tabId: tab.id,
        spaceId: tab.spaceId,
        title: tab.customTitle ?? tab.title,
        ...(cwd ? { cwd } : {}),
        focused: tab.id === activeTabId && tab.activeLeafId === leafId,
        activeInTab: tab.activeLeafId === leafId,
        started: !tab.cold && deps.isMounted(leafId),
        ...(agent ? { agent: { name: agent.agent, status: agent.status } } : {}),
      });
    }
  }
  return { panes, privateTerminals };
}

function tail(text: string, lines: number) {
  const all = text.split("\n");
  const kept = all.length > lines ? all.slice(all.length - lines) : all;
  let out = kept.join("\n");
  let truncated = all.length > lines;
  if (out.length > TERMINAL_READ_MAX_CHARS) {
    out = out.slice(out.length - TERMINAL_READ_MAX_CHARS);
    truncated = true;
  }
  return { text: out, lines: kept.length, truncated };
}

async function waitFor<T>(read: () => T | null): Promise<T | null> {
  const deadline = Date.now() + COMMIT_WAIT_MS;
  for (;;) {
    const value = read();
    if (value !== null) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const SPLIT_DIR: Record<SplitDirection, "row" | "col"> = {
  right: "row",
  down: "col",
};

export function createTerminalControl(deps: TerminalControlDeps): TerminalHandlers {
  const runIn = async (leafId: number, command: string | undefined) => {
    if (!command) return false;
    await deps.whenReady(leafId);
    return deps.write(leafId, `${command}\r`);
  };

  return {
    listTerminals: () =>
      listTerminalPanes(deps.getTabs(), deps.getActiveTabId(), deps),

    readTerminal: async ({ leafId, lines }) => {
      const tab = terminalOf(deps.getTabs(), leafId);
      if (tab.cold || !deps.isMounted(leafId))
        failure(
          `Terminal pane ${leafId} has not started yet; focus its tab with terminal.focus first`,
        );
      const buffer = await deps.readBuffer(
        leafId,
        lines ?? TERMINAL_READ_DEFAULT_LINES,
      );
      // The pane can turn private or close while the buffer is being read.
      if (buffer === null) failure(`Terminal pane ${leafId} cannot be read`);
      return {
        leafId,
        tabId: tab.id,
        ...tail(buffer, lines ?? TERMINAL_READ_DEFAULT_LINES),
      };
    },

    openTerminal: async ({ cwd, command, title }) => {
      const tabId = deps.newTab(cwd ?? deps.defaultCwd());
      const tab = await waitFor(() => {
        const found = deps.getTabs().find((t) => t.id === tabId);
        return found?.kind === "terminal" ? found : null;
      });
      if (!tab) failure("The new terminal did not open");
      if (title) deps.setTabTitle(tabId, title.trim());
      const leafId = tab.activeLeafId;
      const ran = await runIn(leafId, command);
      return { tabId, leafId, ...(command ? { commandSent: ran } : {}) };
    },

    splitTerminal: async ({ leafId, direction, command }) => {
      const tab = terminalOf(deps.getTabs(), leafId);
      if (tab.blocks) failure("Block terminals cannot be split");
      if (leafIds(tab.paneTree).length >= deps.maxPanesPerTab)
        failure(`A tab holds at most ${deps.maxPanesPerTab} panes`);
      deps.focusTab(tab.id);
      deps.focusPane(tab.id, leafId);
      deps.splitActivePane(tab.id, SPLIT_DIR[direction]);
      const before = new Set(leafIds(tab.paneTree));
      const created = await waitFor(() => {
        const now = deps.getTabs().find((t) => t.id === tab.id);
        if (now?.kind !== "terminal") return null;
        return leafIds(now.paneTree).find((id) => !before.has(id)) ?? null;
      });
      if (created === null) failure("The pane could not be split");
      const ran = await runIn(created, command);
      return {
        tabId: tab.id,
        leafId: created,
        ...(command ? { commandSent: ran } : {}),
      };
    },

    focusTerminal: ({ leafId }) => {
      const tab = terminalOf(deps.getTabs(), leafId);
      deps.focusTab(tab.id);
      deps.focusPane(tab.id, leafId);
      deps.focusInput(leafId);
      return { tabId: tab.id, leafId };
    },

    closeTerminal: ({ leafId }) => {
      const tab = terminalOf(deps.getTabs(), leafId);
      const last = leafIds(tab.paneTree).length === 1;
      const terminals = deps.getTabs().filter((t) => t.kind === "terminal");
      if (last && terminals.length === 1)
        failure("The last terminal cannot be closed");
      deps.closePane(leafId);
      return { closed: leafId, tabClosed: last };
    },

    sendToTerminal: async ({ leafId, text, submit }) => {
      const tab = terminalOf(deps.getTabs(), leafId);
      if (tab.cold || !deps.isMounted(leafId))
        failure(
          `Terminal pane ${leafId} has not started yet; focus its tab with terminal.focus first`,
        );
      await deps.whenReady(leafId);
      const sent = deps.write(leafId, submit === false ? text : `${text}\r`);
      if (!sent) failure(`Terminal pane ${leafId} is not accepting input`);
      return { leafId, tabId: tab.id, submitted: submit !== false };
    },
  };
}
