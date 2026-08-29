import type { MermaidTab } from "@/modules/tabs";

export function selectMountedMermaidTabs(
  tabs: MermaidTab[],
  activeId: number | null,
): MermaidTab[] {
  return tabs.filter((tab) => !tab.cold && tab.id === activeId);
}
