import { describe, expect, it } from "vitest";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import type { Tab } from "@/modules/tabs";
import { createCardFromUrl, createTextCard } from "@/modules/notes/lib/cards";
import { hydrateTabs, serializeTabs, type SerializedTab } from "./serialize";

function counter(start = 100): () => number {
  let n = start;
  return () => n++;
}

function leafIdsOf(node: PaneNode): number[] {
  return node.kind === "leaf" ? [node.id] : node.children.flatMap(leafIdsOf);
}

function term(over: Partial<Extract<Tab, { kind: "terminal" }>>): Tab {
  return {
    id: 1,
    kind: "terminal",
    spaceId: "s1",
    title: "shell",
    paneTree: { kind: "leaf", id: 2, cwd: "/a" },
    activeLeafId: 2,
    ...over,
  } as Tab;
}

describe("serializeTabs", () => {
  it("drops private terminals and transient kinds", () => {
    const tabs: Tab[] = [
      term({ id: 1 }),
      term({ id: 3, private: true }),
      {
        id: 5,
        kind: "git-diff",
        spaceId: "s1",
        title: "d",
        path: "/a/x",
        repoRoot: "/a",
        mode: "+",
        originalPath: null,
      },
      {
        id: 7,
        kind: "editor",
        spaceId: "s1",
        title: "x",
        path: "/a/x.ts",
        dirty: false,
        preview: false,
      },
    ];
    const out = serializeTabs(tabs);
    expect(out.map((t) => t.kind)).toEqual(["terminal", "editor"]);
  });

  it("marks the active leaf in a split tree", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const [s] = serializeTabs([term({ paneTree: tree, activeLeafId: 12 })]);
    const node = s as Extract<SerializedTab, { kind: "terminal" }>;
    expect(node.tree.kind).toBe("split");
    if (node.tree.kind === "split") {
      expect(node.tree.children[1]).toMatchObject({ cwd: "/b", active: true });
      expect(node.tree.children[0]).not.toHaveProperty("active");
    }
  });
});

describe("hydrateTabs", () => {
  it("round-trips valid tab colors for every persisted tab kind", () => {
    const tabs: Tab[] = [
      term({ color: "teal" }),
      {
        id: 3,
        kind: "editor",
        spaceId: "s1",
        title: "app.ts",
        path: "/a/app.ts",
        dirty: false,
        preview: false,
        color: "blue",
      },
      {
        id: 4,
        kind: "preview",
        spaceId: "s1",
        title: "example.com",
        url: "https://example.com",
        color: "purple",
      },
      {
        id: 5,
        kind: "markdown",
        spaceId: "s1",
        title: "README.md",
        path: "/a/README.md",
        color: "amber",
      },
    ];

    const restored = hydrateTabs(serializeTabs(tabs), "s2", counter());

    expect(restored.map((tab) => tab.color)).toEqual([
      "teal",
      "blue",
      "purple",
      "amber",
    ]);
  });

  it("ignores invalid stored tab colors while preserving legacy entries", () => {
    const serialized = [
      { kind: "editor", path: "/a/app.ts", color: "javascript:alert(1)" },
      { kind: "markdown", path: "/a/README.md" },
    ] as unknown as SerializedTab[];

    const restored = hydrateTabs(serialized, "s1", counter());

    expect(restored).toHaveLength(2);
    expect(restored[0]).not.toHaveProperty("color");
    expect(restored[1]).not.toHaveProperty("color");
  });

  it("round-trips structure, cwd, blocks and active leaf", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "col",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const tabs: Tab[] = [
      term({
        paneTree: tree,
        activeLeafId: 12,
        blocks: true,
        customTitle: "x",
      }),
    ];
    const serialized = serializeTabs(tabs);
    const [restored] = hydrateTabs(serialized, "s2", counter());
    expect(restored.kind).toBe("terminal");
    if (restored.kind !== "terminal") return;

    expect(restored.spaceId).toBe("s2");
    expect(restored.cold).toBe(true);
    expect(restored.blocks).toBe(true);
    expect(restored.customTitle).toBe("x");
    expect(restored.paneTree.kind).toBe("split");

    const leaves = leafIdsOf(restored.paneTree);
    expect(new Set(leaves).size).toBe(2);
    expect(leaves).toContain(restored.activeLeafId);
    // active leaf was the second one, which carried /b
    expect(restored.cwd).toBe("/b");
  });

  it("allocates fresh, unique, monotonic ids across all tabs and leaves", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 11, cwd: "/a" },
        { kind: "leaf", id: 12, cwd: "/b" },
      ],
    };
    const serialized = serializeTabs([
      term({ id: 1, paneTree: tree, activeLeafId: 11 }),
      term({ id: 2 }),
    ]);
    const restored = hydrateTabs(serialized, "s1", counter(100));

    const ids: number[] = [];
    for (const t of restored) {
      ids.push(t.id);
      if (t.kind === "terminal") ids.push(...leafIdsOf(t.paneTree));
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(100);
  });

  it("round-trips per-tab notes for terminal and editor tabs", () => {
    const notes = [
      createTextCard("remember to review", "Note"),
      createCardFromUrl("https://github.com/acme/widgets/pull/42"),
      createCardFromUrl("https://acme.atlassian.net/browse/PROJ-9"),
    ];
    const tabs: Tab[] = [
      term({ notes }),
      {
        id: 3,
        kind: "editor",
        spaceId: "s1",
        title: "app.ts",
        path: "/a/app.ts",
        dirty: false,
        preview: false,
        notes: [createCardFromUrl("https://figma.com/file/x")],
      },
    ];

    const restored = hydrateTabs(serializeTabs(tabs), "s2", counter());

    expect(restored[0].notes?.map((c) => c.kind)).toEqual([
      "text",
      "github-pr",
      "jira",
    ]);
    expect(restored[0].notes?.[0].id).toBe(notes[0].id);
    expect(restored[1].notes?.map((c) => c.kind)).toEqual(["figma"]);
  });

  it("drops invalid stored notes but keeps valid ones", () => {
    const good = createTextCard("keep me");
    const serialized = [
      {
        kind: "editor",
        path: "/a/app.ts",
        notes: [
          good,
          { kind: "mystery", id: "x", createdAt: 1, updatedAt: 1 },
          { kind: "github-pr", id: "y", createdAt: 1, updatedAt: 1 }, // missing url
          null,
          "nope",
        ],
      },
    ] as unknown as SerializedTab[];

    const restored = hydrateTabs(serialized, "s1", counter());
    expect(restored).toHaveLength(1);
    expect(restored[0].notes?.map((c) => c.id)).toEqual([good.id]);
  });

  it("omits notes entirely when a tab has none", () => {
    const [s] = serializeTabs([term({})]);
    expect(s).not.toHaveProperty("notes");
    const [restored] = hydrateTabs([s], "s1", counter());
    expect(restored).not.toHaveProperty("notes");
  });

  it("returns empty for corrupted input without throwing", () => {
    expect(hydrateTabs([] as SerializedTab[], "s1", counter())).toEqual([]);
    expect(
      hydrateTabs(null as unknown as SerializedTab[], "s1", counter()),
    ).toEqual([]);
  });

  it("hydrates editor/preview/markdown as cold with derived titles", () => {
    const serialized: SerializedTab[] = [
      { kind: "editor", path: "/a/foo.ts" },
      { kind: "preview", url: "http://localhost:5173/x" },
      { kind: "markdown", path: "/a/README.md" },
    ];
    const out = hydrateTabs(serialized, "s1", counter());
    expect(out.every((t) => t.cold === true)).toBe(true);
    expect(out.map((t) => t.title)).toEqual([
      "foo.ts",
      "localhost:5173",
      "README.md",
    ]);
  });
});
