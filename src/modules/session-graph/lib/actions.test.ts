import { describe, expect, it } from "vitest";

import type { SessionNode, SessionNodeKind } from "./entries";
import { availableActions, resumeCommand } from "./actions";

function node(
  kind: SessionNodeKind,
  overrides: Partial<SessionNode> = {},
): SessionNode {
  return {
    id: "n1",
    parentId: null,
    kind,
    at: 0,
    preview: "",
    toolNames: [],
    isMilestone: kind === "user",
    isSidechain: false,
    hasReasoning: false,
    isSynthetic: false,
    compaction: null,
    ...overrides,
  };
}

describe("availableActions", () => {
  it("offers branching from a pi entry", () => {
    const actions = availableActions("pi", node("user"), { codeSnapshotFiles: 0 });

    expect(actions.find((a) => a.id === "branch")).toMatchObject({ enabled: true });
  });

  it("refuses to branch a claude transcript, and says why", () => {
    // Claude's format and resume flags differ; it has no `--session <path>`.
    const actions = availableActions("claude", node("user"), { codeSnapshotFiles: 0 });
    const branch = actions.find((a) => a.id === "branch");

    expect(branch?.enabled).toBe(false);
    expect(branch?.reason).toMatch(/not yet verified/i);
  });

  it("offers a code restore only when the entry actually has snapshots", () => {
    const withSnapshots = availableActions("claude", node("user"), {
      codeSnapshotFiles: 12,
    });
    const without = availableActions("claude", node("user"), { codeSnapshotFiles: 0 });

    expect(withSnapshots.find((a) => a.id === "restoreCode")?.enabled).toBe(true);
    expect(without.find((a) => a.id === "restoreCode")?.enabled).toBe(false);
  });

  it("never offers a code restore for pi, because pi records no snapshots", () => {
    // Verified against pi's entry types and its whole config directory.
    const actions = availableActions("pi", node("user"), { codeSnapshotFiles: 99 });
    const restore = actions.find((a) => a.id === "restoreCode");

    expect(restore?.enabled).toBe(false);
    expect(restore?.reason).toMatch(/no file snapshots/i);
  });

  it("counts the files a restore point covers, so the scope is visible first", () => {
    const actions = availableActions("claude", node("user"), { codeSnapshotFiles: 12 });

    expect(actions.find((a) => a.id === "restoreCode")?.detail).toBe("12 files");
  });

  it("always offers copying a resume command", () => {
    for (const agent of ["pi", "claude"] as const) {
      const actions = availableActions(agent, node("user"), { codeSnapshotFiles: 0 });
      expect(actions.find((a) => a.id === "resume")?.enabled).toBe(true);
    }
  });

  it("marks every action that writes, so the UI can confirm before running it", () => {
    const actions = availableActions("pi", node("user"), { codeSnapshotFiles: 0 });

    expect(actions.find((a) => a.id === "branch")?.writes).toBe(true);
    expect(actions.find((a) => a.id === "resume")?.writes).toBe(false);
  });
});

describe("resumeCommand", () => {
  it("resumes a pi session by id", () => {
    expect(resumeCommand("pi", "019fa0f9-a198")).toBe("pi --session 019fa0f9-a198");
  });

  it("resumes a claude session by id", () => {
    expect(resumeCommand("claude", "de6eef26-ec8e")).toBe("claude --resume de6eef26-ec8e");
  });

  it("refuses an id that is not safe to put on a command line", () => {
    for (const bad of ["", "a b", "a;rm -rf /", "$(x)", "../x", "a'b"]) {
      expect(resumeCommand("pi", bad), bad).toBe(null);
    }
  });
});
