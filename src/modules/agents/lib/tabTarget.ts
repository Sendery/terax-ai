import { labelFor, type Tab, type TabColor } from "@/modules/tabs";
import { hasLeaf } from "@/modules/terminal";

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
