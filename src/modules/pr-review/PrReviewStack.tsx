import type { PrReviewTab, Tab } from "@/modules/tabs";

import { PrReviewPane } from "./PrReviewPane";

type Props = {
  tabs: Tab[];
  activeId: number;
  onBaseChange: (tabId: number, base: string) => void;
};

export function PrReviewStack({ tabs, activeId, onBaseChange }: Props) {
  const active = tabs.find(
    (t): t is PrReviewTab => t.kind === "pr-review" && t.id === activeId,
  );
  if (!active) return null;
  return (
    <PrReviewPane
      key={active.id}
      repoRoot={active.repoRoot}
      head={active.head}
      base={active.base}
      onBaseChange={(base) => onBaseChange(active.id, base)}
    />
  );
}
