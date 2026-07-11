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
});
