import { describe, expect, it } from "vitest";
import { joinRepoPath, tabFilePath } from "./tabFilePath";
import type { Tab } from "./useTabs";

const base = { id: 1, spaceId: "default", title: "t" };

describe("tabFilePath", () => {
  it("gives the path of editor, Markdown and AI diff tabs", () => {
    expect(
      tabFilePath({
        ...base,
        kind: "editor",
        path: "/repo/src/main.ts",
        dirty: false,
        preview: true,
      }),
    ).toBe("/repo/src/main.ts");
    expect(
      tabFilePath({ ...base, kind: "markdown", path: "/repo/README.md" }),
    ).toBe("/repo/README.md");
    expect(
      tabFilePath({
        ...base,
        kind: "ai-diff",
        path: "/repo/new.ts",
        originalContent: "",
        proposedContent: "x",
        approvalId: "a",
        status: "pending",
        isNewFile: true,
      }),
    ).toBe("/repo/new.ts");
  });

  it("makes git diff paths absolute against their repository", () => {
    expect(
      tabFilePath({
        ...base,
        kind: "git-diff",
        path: "src/main.ts",
        repoRoot: "/repo/",
        mode: "+",
        originalPath: null,
      }),
    ).toBe("/repo/src/main.ts");
    expect(
      tabFilePath({
        ...base,
        kind: "git-commit-file",
        path: "docs/a.md",
        repoRoot: "/repo",
        sha: "abc",
        shortSha: "abc",
        subject: "s",
        originalPath: null,
      }),
    ).toBe("/repo/docs/a.md");
  });

  it("gives nothing for tabs that do not show a file", () => {
    const others: Tab[] = [
      {
        ...base,
        kind: "terminal",
        paneTree: { kind: "leaf", id: 2 },
        activeLeafId: 2,
        cwd: "/repo",
      },
      { ...base, kind: "preview", url: "http://localhost:3000" },
      { ...base, kind: "mermaid", source: "graph TD" },
      { ...base, kind: "reader", docId: "doc" },
      { ...base, kind: "git-history", repoRoot: "/repo" },
    ];
    for (const tab of others) expect(tabFilePath(tab), tab.kind).toBeNull();
    expect(
      tabFilePath({ ...base, kind: "markdown", path: "" }),
    ).toBeNull();
  });
});

describe("joinRepoPath", () => {
  it("keeps an absolute path as it is", () => {
    expect(joinRepoPath("/repo", "/elsewhere/a.ts")).toBe("/elsewhere/a.ts");
    expect(joinRepoPath("C:\\repo", "D:\\a.ts")).toBe("D:\\a.ts");
  });

  it("follows a Windows root's separators", () => {
    expect(joinRepoPath("C:\\repo\\", "src/main.ts")).toBe(
      "C:\\repo\\src\\main.ts",
    );
  });

  it("joins under the filesystem root", () => {
    expect(joinRepoPath("/", "a.ts")).toBe("/a.ts");
  });

  it("keeps literal backslashes in POSIX filenames", () => {
    expect(joinRepoPath("/repo", "a\\b.ts")).toBe("/repo/a\\b.ts");
    expect(joinRepoPath("/repo", "\\a.ts")).toBe("/repo/\\a.ts");
  });
});
