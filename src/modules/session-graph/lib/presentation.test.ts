import { describe, expect, it } from "vitest";

import type { SessionNode, SessionNodeKind } from "./entries";
import { buildSessionGraph } from "./graph";
import {
  foldRows,
  hasOutgoingEdge,
  nextMilestoneRow,
  previousMilestoneRow,
  railTicks,
  rowSummary,
} from "./presentation";

function node(
  id: string,
  parentId: string | null,
  kind: SessionNodeKind = "user",
  overrides: Partial<SessionNode> = {},
): SessionNode {
  return {
    id,
    parentId,
    kind,
    at: 0,
    preview: id,
    toolNames: [],
    isMilestone: kind === "user",
    isSidechain: false,
    hasReasoning: false,
    isSynthetic: false,
    compaction: null,
    ...overrides,
  };
}

describe("rowSummary", () => {
  it("shows the user message as the headline of a turn", () => {
    const summary = rowSummary(node("a1", null, "user", { preview: "add a panel" }));

    expect(summary).toEqual({ label: "add a panel", detail: null, isEmphasis: true });
  });

  it("labels tool calls by name so a row is readable without expanding", () => {
    const summary = rowSummary(
      node("a2", "a1", "assistant", { preview: "on it", toolNames: ["read", "edit"] }),
    );

    expect(summary.label).toBe("on it");
    expect(summary.detail).toBe("read, edit");
    expect(summary.isEmphasis).toBe(false);
  });

  it("falls back to the tool names when the agent said nothing", () => {
    const summary = rowSummary(
      node("a3", "a2", "assistant", { preview: "", toolNames: ["bash"] }),
    );

    expect(summary.label).toBe("bash");
  });

  it("renders injected context like machine work, not like a request", () => {
    const summary = rowSummary(
      node("a10", null, "user", {
        preview: "<task-notification> …",
        isSynthetic: true,
        isMilestone: false,
      }),
    );

    expect(summary.isEmphasis).toBe(false);
    expect(summary.detail).toBe("injected");
  });

  it("still emphasises a real user request", () => {
    const summary = rowSummary(node("a11", null, "user", { preview: "add a panel" }));

    expect(summary.isEmphasis).toBe(true);
    expect(summary.detail).toBe(null);
  });

  it("says an entry was reasoning rather than calling it empty", () => {
    const summary = rowSummary(
      node("a8", "a7", "assistant", { preview: "", hasReasoning: true }),
    );

    expect(summary.label).toBe("thinking…");
  });

  it("prefers what the agent said over the reasoning marker", () => {
    const summary = rowSummary(
      node("a9", "a8", "assistant", { preview: "here goes", hasReasoning: true }),
    );

    expect(summary.label).toBe("here goes");
  });

  it("never renders a blank row for a turn that carried only an attachment", () => {
    // Six real claude user turns have no text at all.
    const summary = rowSummary(node("a4", null, "user", { preview: "" }));

    expect(summary.label).toBe("(no text)");
  });

  it("describes a compaction with the tokens it reclaimed", () => {
    const summary = rowSummary(
      node("a5", "a4", "compaction", {
        preview: "## Goal Build a panel",
        compaction: { firstKeptEntryId: "x9", tokensBefore: 530692 },
      }),
    );

    expect(summary.label).toBe("## Goal Build a panel");
    expect(summary.detail).toBe("compacted 530,692 tokens");
  });

  it("names the model a model change switched to", () => {
    const summary = rowSummary(
      node("a6", "a5", "modelChange", { preview: "anthropic / claude-opus-5" }),
    );

    expect(summary.label).toBe("anthropic / claude-opus-5");
  });

  it("labels a tool result rather than repeating its body", () => {
    const summary = rowSummary(
      node("a7", "a6", "toolResult", { preview: "file body here" }),
    );

    expect(summary.detail).toBe("result");
  });
});

describe("foldRows", () => {
  const rows = buildSessionGraph(
    [
      node("u1", null, "user"),
      node("a1", "u1", "assistant"),
      node("t1", "a1", "toolResult"),
      node("u2", "t1", "user"),
      node("a2", "u2", "assistant"),
    ],
    "a2",
  ).rows;

  it("shows every row when nothing is folded", () => {
    const folded = foldRows(rows, new Set());

    expect(folded.map((r) => r.kind)).toEqual(["row", "row", "row", "row", "row"]);
  });

  it("hides the agent work of a folded turn but keeps its user message", () => {
    const folded = foldRows(rows, new Set([0]));

    expect(folded.map((r) => (r.kind === "row" ? r.row.node.id : `fold:${r.hiddenCount}`))).toEqual(
      ["u1", "fold:2", "u2", "a2"],
    );
  });

  it("counts only the rows it actually hid", () => {
    const folded = foldRows(rows, new Set([1]));
    const stub = folded.find((r) => r.kind === "fold");

    expect(stub).toMatchObject({ kind: "fold", turnIndex: 1, hiddenCount: 1 });
  });

  it("folds several turns at once", () => {
    const folded = foldRows(rows, new Set([0, 1]));

    expect(folded.filter((r) => r.kind === "fold")).toHaveLength(2);
    expect(folded.filter((r) => r.kind === "row")).toHaveLength(2);
  });

  it("never folds a user milestone away, so navigation always has anchors", () => {
    const folded = foldRows(rows, new Set([0, 1]));
    const visibleIds = folded.flatMap((r) => (r.kind === "row" ? [r.row.node.id] : []));

    expect(visibleIds).toEqual(["u1", "u2"]);
  });
});

describe("hasOutgoingEdge", () => {
  // Spur `s2` ends the abandoned branch; `s1` continues into two children.
  const rows = buildSessionGraph(
    [
      node("s1", null, "assistant"),
      node("s2", "s1", "user"),
      node("s3", "s1", "user"),
      node("s4", "s3", "assistant"),
    ],
    "s4",
  ).rows;
  const byId = new Map(rows.map((r) => [r.node.id, r]));

  it("draws a downward edge from a node that has children", () => {
    expect(hasOutgoingEdge(byId.get("s1") as never)).toBe(true);
    expect(hasOutgoingEdge(byId.get("s3") as never)).toBe(true);
  });

  it("does not leave an edge hanging below a leaf", () => {
    expect(hasOutgoingEdge(byId.get("s2") as never)).toBe(false);
    expect(hasOutgoingEdge(byId.get("s4") as never)).toBe(false);
  });
});

describe("milestone rail", () => {
  const graph = buildSessionGraph(
    [
      node("u1", null, "user"),
      node("a1", "u1", "assistant"),
      node("a2", "a1", "assistant"),
      node("u2", "a2", "user"),
      node("a3", "u2", "assistant"),
      node("u3", "a3", "user"),
    ],
    "u3",
  );

  it("places a tick at the relative position of every user turn", () => {
    const ticks = railTicks(graph.milestones, graph.rows.length);

    expect(ticks.map((t) => t.nodeId)).toEqual(["u1", "u2", "u3"]);
    expect(ticks[0].position).toBe(0);
    expect(ticks[1].position).toBeCloseTo(0.5, 5);
    expect(ticks[2].position).toBeCloseTo(0.8333, 3);
  });

  it("returns no ticks when there is nothing to anchor to", () => {
    expect(railTicks([], 0)).toEqual([]);
  });

  it("keeps a single milestone at the top instead of dividing by zero", () => {
    const single = buildSessionGraph([node("only", null, "user")], "only");

    expect(railTicks(single.milestones, single.rows.length)).toEqual([
      { nodeId: "only", rowIndex: 0, position: 0, preview: "only" },
    ]);
  });

  it("jumps forward to the next user turn, the way an index does", () => {
    expect(nextMilestoneRow(graph.milestones, 0)).toBe(3);
    expect(nextMilestoneRow(graph.milestones, 1)).toBe(3);
    expect(nextMilestoneRow(graph.milestones, 3)).toBe(5);
  });

  it("stays put at the last milestone rather than scrolling past the end", () => {
    expect(nextMilestoneRow(graph.milestones, 5)).toBe(5);
    expect(nextMilestoneRow(graph.milestones, 99)).toBe(5);
  });

  it("jumps back to the previous user turn", () => {
    expect(previousMilestoneRow(graph.milestones, 5)).toBe(3);
    expect(previousMilestoneRow(graph.milestones, 4)).toBe(3);
    expect(previousMilestoneRow(graph.milestones, 3)).toBe(0);
  });

  it("stays at the first milestone when already above it", () => {
    expect(previousMilestoneRow(graph.milestones, 0)).toBe(0);
  });

  it("has no target to jump to in an empty session", () => {
    expect(nextMilestoneRow([], 0)).toBe(null);
    expect(previousMilestoneRow([], 0)).toBe(null);
  });
});
