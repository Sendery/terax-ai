import type { Tab } from "./useTabs";

export type MermaidTabReplacement = {
  tabs: Tab[];
  updated: boolean;
};

export type MermaidTabCommitScheduler = (callback: () => void) => void;

export function waitForMermaidTabReplacement(
  readTabs: () => Tab[],
  tabId: number,
  source: string,
  title?: string,
  schedule: MermaidTabCommitScheduler = (callback) => {
    requestAnimationFrame(callback);
  },
  maxAttempts = 120,
): Promise<Extract<Tab, { kind: "mermaid" }>> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const tab = readTabs().find((candidate) => candidate.id === tabId);
      if (
        tab?.kind === "mermaid" &&
        tab.source === source &&
        (title === undefined || tab.customTitle === title)
      ) {
        resolve(tab);
        return;
      }
      attempts += 1;
      if (attempts >= maxAttempts) {
        reject(new Error("Mermaid tab update did not commit"));
        return;
      }
      schedule(check);
    };
    check();
  });
}

export function replaceMermaidTab(
  tabs: Tab[],
  tabId: number,
  source: string,
  title?: string,
): MermaidTabReplacement {
  const index = tabs.findIndex(
    (tab) => tab.id === tabId && tab.kind === "mermaid",
  );
  if (index < 0) return { tabs, updated: false };

  const current = tabs[index];
  if (current.kind !== "mermaid") return { tabs, updated: false };
  const { visualLayout: _staleLayout, ...withoutLayout } = current;
  const next: Tab = {
    ...withoutLayout,
    source,
    ...(title === undefined ? {} : { customTitle: title }),
  };
  const nextTabs = [...tabs];
  nextTabs[index] = next;
  return { tabs: nextTabs, updated: true };
}
