import { describe, expect, it } from "vitest";

import type { SessionNode, SessionNodeKind } from "./entries";
import { buildSessionGraph } from "./graph";
import {
  collapseByDensity,
  DENSITIES,
  nextDensity,
  shortToolName,
  topTools,
} from "./density";

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

/**
 * Two turns of realistic shape: a user message, reasoning, two tool calls with
 * their results, then another user message.
 */
const ROWS = buildSessionGraph(
  [
    node("u1", null, "user", { preview: "add a panel" }),
    node("a1", "u1", "assistant", { preview: "", hasReasoning: true }),
    node("a2", "a1", "assistant", { preview: "reading", toolNames: ["read"] }),
    node("t1", "a2", "toolResult", { preview: "file body" }),
    node("a3", "t1", "assistant", { preview: "editing", toolNames: ["edit"] }),
    node("t2", "a3", "toolResult", { preview: "ok" }),
    node("u2", "t2", "user", { preview: "now the tests" }),
    node("a4", "u2", "assistant", { preview: "done" }),
  ],
  "a4",
).rows;

const NO_MARKS = new Set<string>();

describe("collapseByDensity", () => {
  it("shows every entry at full density", () => {
    const entries = collapseByDensity(ROWS, "full", new Set(), NO_MARKS);

    expect(entries.every((e) => e.kind === "row")).toBe(true);
    expect(entries).toHaveLength(8);
  });

  it("reduces an overview to user turns with one group between them", () => {
    const entries = collapseByDensity(ROWS, "overview", new Set(), NO_MARKS);

    expect(
      entries.map((e) => (e.kind === "row" ? e.row.node.id : `group:${e.hiddenCount}`)),
    ).toEqual(["u1", "group:5", "u2", "group:1"]);
  });

  it("tallies the tools a collapsed group hid, so the overview still says what happened", () => {
    const entries = collapseByDensity(ROWS, "overview", new Set(), NO_MARKS);
    const group = entries.find((e) => e.kind === "group");

    expect(group).toMatchObject({
      kind: "group",
      turnIndex: 0,
      hiddenCount: 5,
      tools: [
        { name: "read", count: 1 },
        { name: "edit", count: 1 },
      ],
    });
  });

  it("counts a repeated tool once with its multiplicity", () => {
    const rows = buildSessionGraph(
      [
        node("v1", null, "user"),
        node("v2", "v1", "assistant", { toolNames: ["bash"] }),
        node("v3", "v2", "assistant", { toolNames: ["bash", "bash"] }),
      ],
      "v3",
    ).rows;

    const group = collapseByDensity(rows, "overview", new Set(), NO_MARKS).find(
      (e) => e.kind === "group",
    );

    expect(group).toMatchObject({ tools: [{ name: "bash", count: 3 }] });
  });

  it("keeps tool calls visible at compact density but folds their results", () => {
    const entries = collapseByDensity(ROWS, "compact", new Set(), NO_MARKS);

    expect(
      entries.map((e) => (e.kind === "row" ? e.row.node.id : `group:${e.hiddenCount}`)),
    ).toEqual(["u1", "group:1", "a2", "group:1", "a3", "group:1", "u2", "group:1"]);
  });

  it("expands one turn on demand without leaving the chosen density", () => {
    const entries = collapseByDensity(ROWS, "overview", new Set([0]), NO_MARKS);

    expect(entries.map((e) => (e.kind === "row" ? e.row.node.id : "group"))).toEqual([
      "u1",
      "a1",
      "a2",
      "t1",
      "a3",
      "t2",
      "u2",
      "group",
    ]);
  });

  it("never hides a marked entry, whatever the density", () => {
    // A key point the user recorded must stay findable when zoomed out.
    const entries = collapseByDensity(ROWS, "overview", new Set(), new Set(["t1"]));

    const ids = entries.flatMap((e) => (e.kind === "row" ? [e.row.node.id] : []));
    expect(ids).toContain("t1");
  });

  it("splits the group around a marked entry instead of swallowing it", () => {
    const entries = collapseByDensity(ROWS, "overview", new Set(), new Set(["t1"]));

    expect(
      entries.map((e) => (e.kind === "row" ? e.row.node.id : `group:${e.hiddenCount}`)),
    ).toEqual(["u1", "group:2", "t1", "group:2", "u2", "group:1"]);
  });

  it("never hides a branch point, and says the group contains one", () => {
    // A rewind is structural: collapsing it away would hide the graph's shape.
    const rows = buildSessionGraph(
      [
        node("w1", null, "user"),
        node("w2", "w1", "assistant"),
        node("w3", "w2", "toolResult"),
        node("w4", "w2", "user"),
      ],
      "w4",
    ).rows;

    const entries = collapseByDensity(rows, "overview", new Set(), NO_MARKS);
    const ids = entries.flatMap((e) => (e.kind === "row" ? [e.row.node.id] : []));

    expect(ids).toContain("w2");
  });

  it("records where a group starts so a click can jump into it", () => {
    const entries = collapseByDensity(ROWS, "overview", new Set(), NO_MARKS);
    const group = entries.find((e) => e.kind === "group");

    expect(group).toMatchObject({ firstRowIndex: 1 });
  });

  it("emits nothing for an empty graph", () => {
    expect(collapseByDensity([], "overview", new Set(), NO_MARKS)).toEqual([]);
  });

  it("does not emit an empty group when a turn has no hidden work", () => {
    const rows = buildSessionGraph([node("x1", null, "user"), node("x2", "x1", "user")], "x2").rows;

    const entries = collapseByDensity(rows, "overview", new Set(), NO_MARKS);

    expect(entries.every((e) => e.kind === "row")).toBe(true);
  });
});

describe("topTools", () => {
  const tools = [
    { name: "terax_status", count: 1 },
    { name: "bash", count: 42 },
    { name: "read", count: 7 },
    { name: "write", count: 5 },
    { name: "edit", count: 3 },
  ];

  it("shows everything when it fits", () => {
    expect(topTools(tools, 5)).toEqual({ shown: tools, extra: 0 });
  });

  it("keeps the most-used tools and reports how many were cut", () => {
    // Clipping the last chip mid-word is what this prevents.
    const { shown, extra } = topTools(tools, 3);

    expect(shown.map((t) => t.name)).toEqual(["bash", "read", "write"]);
    expect(extra).toBe(2);
  });

  it("does not mutate the tally it was given", () => {
    topTools(tools, 2);

    expect(tools[0].name).toBe("terax_status");
  });

  it("handles an empty tally", () => {
    expect(topTools([], 3)).toEqual({ shown: [], extra: 0 });
  });
});

describe("shortToolName", () => {
  it("leaves a normal tool name alone", () => {
    for (const name of ["bash", "read", "Edit", "AskUserQuestion"]) {
      expect(shortToolName(name).startsWith(name.slice(0, 4))).toBe(true);
    }
    expect(shortToolName("bash")).toBe("bash");
  });

  it("keeps the meaningful tail of a namespaced tool", () => {
    // The prefix is the server, the tail is what it does.
    expect(shortToolName("mcp__notion__search")).toBe("search");
  });

  it("truncates a long name that has no namespace, instead of clipping the row", () => {
    const short = shortToolName("terax_visual_qa_runner");

    expect(short.length).toBeLessThanOrEqual(13);
    expect(short.endsWith("\u2026")).toBe(true);
  });

  it("truncates a namespaced tail that is still too long", () => {
    expect(shortToolName("mcp__x__an_extremely_long_operation").length).toBeLessThanOrEqual(13);
  });
});

describe("nextDensity", () => {
  it("cycles from the widest overview to full detail and back", () => {
    expect(DENSITIES).toEqual(["overview", "compact", "full"]);
    expect(nextDensity("overview")).toBe("compact");
    expect(nextDensity("compact")).toBe("full");
    expect(nextDensity("full")).toBe("overview");
  });

  it("steps back the other way", () => {
    expect(nextDensity("full", -1)).toBe("compact");
    expect(nextDensity("overview", -1)).toBe("full");
  });
});
