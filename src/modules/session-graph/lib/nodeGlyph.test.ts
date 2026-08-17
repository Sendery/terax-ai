import { describe, expect, it } from "vitest";

import type { SessionNode, SessionNodeKind } from "./entries";
import { nodeGlyph, TONE_COLOR, TONES } from "./nodeGlyph";

function node(
  kind: SessionNodeKind,
  overrides: Partial<SessionNode> = {},
): SessionNode {
  return {
    id: "n",
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

describe("nodeGlyph", () => {
  it("gives a user turn its own tone and the largest node", () => {
    const glyph = nodeGlyph(node("user", { preview: "add a panel" }));

    expect(glyph.tone).toBe("user");
    expect(glyph.size).toBe("large");
    expect(glyph.icon).not.toBe(null);
  });

  it("tones injected context as system, not as a request", () => {
    const glyph = nodeGlyph(
      node("user", { preview: "<task-notification>", isSynthetic: true, isMilestone: false }),
    );

    expect(glyph.tone).toBe("system");
    expect(glyph.size).not.toBe("large");
  });

  it("classifies tools into families so colour carries meaning", () => {
    const families: [string, string][] = [
      ["bash", "shell"],
      ["Bash", "shell"],
      ["run_command", "shell"],
      ["read", "read"],
      ["Read", "read"],
      ["grep", "read"],
      ["glob", "read"],
      ["find", "read"],
      ["ls", "read"],
      ["edit", "write"],
      ["Write", "write"],
      ["NotebookEdit", "write"],
      ["Task", "agent"],
      ["Agent", "agent"],
      ["Skill", "agent"],
      ["WebFetch", "web"],
      ["WebSearch", "web"],
      ["TodoWrite", "plan"],
      ["AskUserQuestion", "ask"],
    ];

    for (const [tool, tone] of families) {
      expect(nodeGlyph(node("assistant", { toolNames: [tool] })).tone, tool).toBe(tone);
    }
  });

  it("falls back to a generic tool tone for something unknown", () => {
    expect(nodeGlyph(node("assistant", { toolNames: ["mcp__weird__thing"] })).tone).toBe(
      "tool",
    );
  });

  it("takes the first tool when an entry called several", () => {
    const glyph = nodeGlyph(node("assistant", { toolNames: ["bash", "read"] }));

    expect(glyph.tone).toBe("shell");
  });

  it("marks a reasoning-only entry as thinking", () => {
    const glyph = nodeGlyph(node("assistant", { preview: "", hasReasoning: true }));

    expect(glyph.tone).toBe("thinking");
  });

  it("prefers the tool over reasoning when the entry did both", () => {
    const glyph = nodeGlyph(
      node("assistant", { hasReasoning: true, toolNames: ["bash"] }),
    );

    expect(glyph.tone).toBe("shell");
  });

  it("draws a tool result as a plain small dot, like a merge commit", () => {
    const glyph = nodeGlyph(node("toolResult", { preview: "output" }));

    expect(glyph.tone).toBe("result");
    expect(glyph.size).toBe("small");
    expect(glyph.icon).toBe(null);
  });

  it("gives structural entries their own tones", () => {
    expect(nodeGlyph(node("compaction")).tone).toBe("compaction");
    expect(nodeGlyph(node("branchSummary")).tone).toBe("branch");
    expect(nodeGlyph(node("modelChange")).tone).toBe("system");
    expect(nodeGlyph(node("thinkingLevelChange")).tone).toBe("system");
    expect(nodeGlyph(node("sessionInfo")).tone).toBe("system");
  });

  it("names every tone it can return so the legend stays complete", () => {
    const kinds: SessionNodeKind[] = [
      "user",
      "assistant",
      "toolResult",
      "compaction",
      "branchSummary",
      "modelChange",
      "thinkingLevelChange",
      "sessionInfo",
      "customMessage",
    ];

    for (const kind of kinds) {
      expect(TONES).toContain(nodeGlyph(node(kind)).tone);
    }
  });

  it("has a colour for every tone", () => {
    for (const tone of TONES) {
      expect(TONE_COLOR[tone]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("describes the glyph for assistive technology", () => {
    expect(nodeGlyph(node("assistant", { toolNames: ["bash"] })).label).toBe("shell command");
    expect(nodeGlyph(node("user")).label).toBe("user turn");
  });
});
