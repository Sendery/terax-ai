import { describe, expect, it } from "vitest";
import { buildAppSnapshot } from "./snapshot";
import type { Tab } from "@/modules/tabs";

describe("buildAppSnapshot", () => {
  it("serializes useful app state without terminal buffers or private tab details", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        spaceId: "default",
        title: "shell",
        customTitle: "prod shell",
        cwd: "/repo",
        paneTree: { kind: "leaf", id: 2, cwd: "/repo" },
        activeLeafId: 2,
      },
      {
        id: 3,
        kind: "terminal",
        spaceId: "default",
        title: "private",
        cwd: "/private-home",
        paneTree: { kind: "leaf", id: 4, cwd: "/private-home" },
        activeLeafId: 4,
        private: true,
      },
      {
        id: 5,
        kind: "ai-diff",
        spaceId: "default",
        title: "secrets.ts (AI diff)",
        path: "/repo/secrets.ts",
        originalContent: "old secret",
        proposedContent: "new secret",
        approvalId: "approval-private",
        status: "pending",
        isNewFile: false,
      },
      {
        id: 6,
        kind: "editor",
        spaceId: "default",
        title: "main.ts",
        path: "/repo/main.ts",
        dirty: true,
        preview: false,
      },
    ];

    const snapshot = buildAppSnapshot({
      tabs,
      activeTabId: 6,
      activeSpaceId: "default",
      sidebar: { visible: true, view: "explorer" },
    });

    expect(snapshot).toEqual({
      version: 1,
      activeTabId: 6,
      activeSpaceId: "default",
      sidebar: { visible: true, view: "explorer" },
      tabs: [
        {
          id: 1,
          kind: "terminal",
          spaceId: "default",
          title: "prod shell",
          cwd: "/repo",
          paneCount: 1,
        },
        {
          id: 3,
          kind: "private-terminal",
          spaceId: "default",
        },
        {
          id: 5,
          kind: "ai-diff",
          spaceId: "default",
          title: "secrets.ts (AI diff)",
          path: "/repo/secrets.ts",
          status: "pending",
          isNewFile: false,
        },
        {
          id: 6,
          kind: "editor",
          spaceId: "default",
          title: "main.ts",
          path: "/repo/main.ts",
          dirty: true,
          preview: false,
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("old secret");
    expect(JSON.stringify(snapshot)).not.toContain("new secret");
    expect(JSON.stringify(snapshot)).not.toContain("approval-private");
    expect(JSON.stringify(snapshot)).not.toContain("/private-home");
  });

  it("includes color in the snapshot when set on a tab", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        spaceId: "default",
        title: "shell",
        color: "teal",
        paneTree: { kind: "leaf", id: 2 },
        activeLeafId: 2,
      },
      {
        id: 3,
        kind: "editor",
        spaceId: "default",
        title: "main.ts",
        path: "/repo/main.ts",
        dirty: false,
        preview: false,
        color: "purple",
      },
      {
        id: 5,
        kind: "terminal",
        spaceId: "default",
        title: "uncolored",
        paneTree: { kind: "leaf", id: 6 },
        activeLeafId: 6,
      },
    ];

    const snapshot = buildAppSnapshot({
      tabs,
      activeTabId: 1,
      activeSpaceId: "default",
    });

    expect(snapshot.tabs[0]).toMatchObject({
      id: 1,
      kind: "terminal",
      color: "teal",
    });
    expect(snapshot.tabs[1]).toMatchObject({
      id: 3,
      kind: "editor",
      color: "purple",
    });
    expect(snapshot.tabs[2]).not.toHaveProperty("color");
  });

  it("does not expose color for private terminals", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        spaceId: "default",
        title: "private",
        color: "red" as const,
        paneTree: { kind: "leaf", id: 2 },
        activeLeafId: 2,
        private: true,
      },
    ];
    const snapshot = buildAppSnapshot({
      tabs,
      activeTabId: 1,
      activeSpaceId: "default",
    });
    expect(snapshot.tabs[0].kind).toBe("private-terminal");
    expect(JSON.stringify(snapshot)).not.toContain('"color"');
  });

  it("serializes color for every non-private tab kind", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "markdown",
        spaceId: "default",
        title: "README",
        path: "README.md",
        color: "teal" as const,
      },
      {
        id: 2,
        kind: "git-history",
        spaceId: "default",
        title: "History",
        repoRoot: "/repo",
        color: "orange" as const,
      },
      {
        id: 3,
        kind: "git-diff",
        spaceId: "default",
        title: "diff",
        path: "a.ts",
        repoRoot: "/repo",
        mode: "+" as const,
        originalPath: null,
        color: "blue" as const,
      },
    ];
    const snapshot = buildAppSnapshot({
      tabs,
      activeTabId: 1,
      activeSpaceId: "default",
    });
    expect(snapshot.tabs[0]).toMatchObject({ kind: "markdown", color: "teal" });
    expect(snapshot.tabs[1]).toMatchObject({
      kind: "git-history",
      color: "orange",
    });
    expect(snapshot.tabs[2]).toMatchObject({ kind: "git-diff", color: "blue" });
  });
});
