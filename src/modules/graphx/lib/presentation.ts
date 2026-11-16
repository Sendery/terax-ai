import type { GraphTab, Tab } from "@/modules/tabs";
export function visibleGraph(
  tabs: readonly Tab[],
  activeTab: Tab | undefined,
): GraphTab | undefined {
  if (activeTab?.kind === "graphx") return activeTab;
  if (activeTab?.kind !== "terminal" || activeTab.private) return;
  return tabs.find(
    (t): t is GraphTab =>
      t.kind === "graphx" &&
      t.spaceId === activeTab.spaceId &&
      t.placement !== "tab",
  );
}
export function graphDockMargins(
  tabs: readonly Tab[],
  activeTab: Tab | undefined,
) {
  const graph = visibleGraph(tabs, activeTab);
  if (activeTab?.kind !== "terminal" || !graph) return {};
  const width = `min(${graph.panel?.width ?? 560}px, 60%)`;
  return {
    marginLeft: graph.placement === "left" ? width : undefined,
    marginRight: graph.placement === "right" ? width : undefined,
  };
}
