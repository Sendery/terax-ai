import type { GraphTab, Tab, TerminalTab } from "@/modules/tabs";
import type { GraphPlacement } from "./document";

export function graphPlacementTarget(
  tabs: readonly Tab[],
  graph: Pick<GraphTab, "id" | "spaceId">,
  placement: GraphPlacement,
  activeId: number,
  remembered: ReadonlyMap<string, number>,
): number {
  if (placement === "tab") return graph.id;
  const terminals = tabs.filter(
    (tab) =>
      tab.kind === "terminal" && tab.spaceId === graph.spaceId && !tab.private,
  );
  return (
    terminals.find((tab) => tab.id === activeId)?.id ??
    terminals.find((tab) => tab.id === remembered.get(graph.spaceId))?.id ??
    terminals[0]?.id ??
    graph.id
  );
}

export function rememberGraphTerminalFocus(
  tabs: readonly Tab[],
  activeId: number,
  previous: ReadonlyMap<string, number>,
): Map<string, number> {
  const remembered = new Map<string, number>();
  let active: TerminalTab | undefined;
  for (const tab of tabs) {
    if (tab.kind !== "terminal" || tab.private) continue;
    if (previous.get(tab.spaceId) === tab.id)
      remembered.set(tab.spaceId, tab.id);
    if (tab.id === activeId) active = tab;
  }
  if (active) remembered.set(active.spaceId, active.id);
  return remembered;
}
