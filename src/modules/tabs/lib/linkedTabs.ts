import type { Tab } from "./useTabs";

export type TabLink = { key: string; side: "left" | "right"; percent?: number };
export type LinkedTabs = { key: string; leftId: number; rightId: number; percent: number };

export const MIN_SPLIT_PERCENT = 20;
export const MAX_SPLIT_PERCENT = 80;
const SPLIT_KEY = /^[0-9a-f-]{36}$/i;

export function splitPercent(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(MIN_SPLIT_PERCENT, Math.min(MAX_SPLIT_PERCENT, Math.round(value * 10) / 10));
}

export function parseTabLink(value: unknown): TabLink | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { key, side, percent } = value as Partial<TabLink>;
  if (typeof key !== "string" || !SPLIT_KEY.test(key) || (side !== "left" && side !== "right"))
    return undefined;
  return { key, side, ...(side === "left" && typeof percent === "number" && { percent: splitPercent(percent) }) };
}

export function canLinkTab(tab: Tab): boolean {
  return tab.kind === "terminal" ? !tab.private
    : tab.kind === "editor" || tab.kind === "markdown" || tab.kind === "preview";
}

export function indexLinkedTabs(tabs: readonly Tab[]): Map<number, LinkedTabs> {
  const entries = new Map<string, Tab[]>();
  for (const tab of tabs) {
    if (!tab.linkedView || !canLinkTab(tab)) continue;
    const group = entries.get(tab.linkedView.key) ?? [];
    group.push(tab);
    entries.set(tab.linkedView.key, group);
  }
  const links = new Map<number, LinkedTabs>();
  for (const [key, group] of entries) {
    if (group.length !== 2 || group[0].spaceId !== group[1].spaceId) continue;
    const left = group.find((tab) => tab.linkedView?.side === "left");
    const right = group.find((tab) => tab.linkedView?.side === "right");
    if (!left || !right) continue;
    const link = { key, leftId: left.id, rightId: right.id, percent: splitPercent(left.linkedView?.percent ?? 50) };
    links.set(left.id, link);
    links.set(right.id, link);
  }
  return links;
}

export function cleanLinkedTabs(tabs: Tab[]): Tab[] {
  if (!tabs.some((tab) => tab.linkedView)) return tabs;
  const links = indexLinkedTabs(tabs);
  if (!tabs.some((tab) => tab.linkedView && !links.has(tab.id))) return tabs;
  return tabs.map((tab) => tab.linkedView && !links.has(tab.id) ? { ...tab, linkedView: undefined } : tab);
}

export function linkTabs(tabs: Tab[], leftId: number, rightId: number, key: string): Tab[] {
  const left = tabs.find((tab) => tab.id === leftId);
  const right = tabs.find((tab) => tab.id === rightId);
  if (!left || !right || left === right || left.spaceId !== right.spaceId ||
    left.linkedView || right.linkedView || !canLinkTab(left) || !canLinkTab(right)) return tabs;
  return tabs.map((tab) => {
    if (tab.id !== leftId && tab.id !== rightId) return tab;
    return {
      ...tab,
      ...(tab.kind === "editor" && { preview: false }),
      linkedView: { key, side: tab.id === leftId ? "left" : "right" },
      cold: false,
    };
  });
}

export function warmActiveTabs(tabs: Tab[], activeId: number): Tab[] {
  const active = tabs.find((tab) => tab.id === activeId);
  if (!active) return tabs;
  const key = active.linkedView?.key;
  const shouldWarm = (tab: Tab) =>
    tab.cold && (tab === active || (key !== undefined && tab.linkedView?.key === key));
  if (!tabs.some(shouldWarm)) return tabs;
  return tabs.map((tab) => shouldWarm(tab) ? { ...tab, cold: false } : tab);
}

export function unlinkTabs(tabs: Tab[], tabId: number): Tab[] {
  const key = tabs.find((tab) => tab.id === tabId)?.linkedView?.key;
  return key ? tabs.map((tab) => tab.linkedView?.key === key ? { ...tab, linkedView: undefined } : tab) : tabs;
}

export function resizeLinkedTabs(tabs: Tab[], key: string, requested: number): Tab[] {
  const left = tabs.find((tab) => tab.linkedView?.key === key && tab.linkedView.side === "left");
  const percent = splitPercent(requested);
  if (!left?.linkedView || percent === (left.linkedView.percent ?? 50)) return tabs;
  return tabs.map((tab) => tab === left && tab.linkedView
    ? { ...tab, linkedView: { ...tab.linkedView, percent } } : tab);
}

export function linkedSide(link: LinkedTabs | undefined, id: number): TabLink["side"] | undefined {
  return id === link?.leftId ? "left" : id === link?.rightId ? "right" : undefined;
}
