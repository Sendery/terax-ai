import { describe, expect, it } from "vitest";
import {
  replaceMermaidTab,
  waitForMermaidTabReplacement,
} from "./mermaidTabMutation";
import type { Tab } from "./useTabs";

const mermaid: Tab = {
  id: 13,
  kind: "mermaid",
  spaceId: "space-1",
  title: "Original",
  customTitle: "Custom",
  source: "flowchart LR\nA-->B",
  visualLayout: { kind: "flowchart", positions: { A: { x: 40, y: 40 } } },
};

describe("replaceMermaidTab", () => {
  it("replaces source and optional title while clearing stale visual layout", () => {
    const result = replaceMermaidTab(
      [mermaid],
      13,
      "flowchart LR\nA-->C",
      "Updated",
    );

    expect(result.updated).toBe(true);
    expect(result.tabs[0]).toMatchObject({
      id: 13,
      kind: "mermaid",
      source: "flowchart LR\nA-->C",
      title: "Original",
      customTitle: "Updated",
    });
    expect(result.tabs[0]).not.toHaveProperty("visualLayout");
  });

  it("preserves the title when omitted and refuses a non-Mermaid target", () => {
    const unchangedTitle = replaceMermaidTab([mermaid], 13, "sequenceDiagram");
    expect(unchangedTitle.tabs[0]).toMatchObject({ customTitle: "Custom" });

    const markdown: Tab = {
      id: 1,
      kind: "markdown",
      spaceId: "space-1",
      title: "README.md",
      path: "/repo/README.md",
    };
    const refused = replaceMermaidTab([markdown], 1, "flowchart LR\nA-->B");
    expect(refused).toEqual({ tabs: [markdown], updated: false });
  });
});

describe("waitForMermaidTabReplacement", () => {
  it("resolves only after the expected React state becomes observable", async () => {
    let current: Tab[] = [mermaid];
    const expected = replaceMermaidTab(
      current,
      13,
      "sequenceDiagram",
      "Committed",
    ).tabs;
    let scheduled = 0;

    const committed = waitForMermaidTabReplacement(
      () => current,
      13,
      "sequenceDiagram",
      "Committed",
      (callback) => {
        scheduled += 1;
        current = expected;
        callback();
      },
    );

    await expect(committed).resolves.toMatchObject({
      id: 13,
      source: "sequenceDiagram",
      customTitle: "Committed",
    });
    expect(scheduled).toBe(1);
  });

  it("rejects when the committed state never appears", async () => {
    await expect(
      waitForMermaidTabReplacement(
        () => [mermaid],
        13,
        "sequenceDiagram",
        undefined,
        (callback) => callback(),
        2,
      ),
    ).rejects.toThrow("Mermaid tab update did not commit");
  });
});
