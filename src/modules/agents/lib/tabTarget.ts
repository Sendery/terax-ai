import { labelFor, type Tab, type TabColor } from "@/modules/tabs";
import { findLeafCwd, hasLeaf } from "@/modules/terminal";

export type AgentTabTarget = {
  tabId: number;
  /** The label the tab bar shows, so a notification names a tab the user can find. */
  title: string;
  color: TabColor | null;
};

export function findAgentTab(
  tabs: readonly Tab[],
  leafId: number,
): AgentTabTarget | null {
  for (const tab of tabs) {
    if (tab.kind === "terminal" && hasLeaf(tab.paneTree, leafId)) {
      return { tabId: tab.id, title: labelFor(tab), color: tab.color ?? null };
    }
  }
  return null;
}

/** The directory a pane was last in, which is where its agent's transcript lives. */
export function findPaneCwd(
  tabs: readonly Tab[],
  leafId: number,
): string | null {
  for (const tab of tabs) {
    if (tab.kind === "terminal" && hasLeaf(tab.paneTree, leafId)) {
      return findLeafCwd(tab.paneTree, leafId) ?? tab.cwd ?? null;
    }
  }
  return null;
}
