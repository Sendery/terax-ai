import { describe, expect, it } from "vitest";

import { parseSessionLines } from "./entries";

/** A Pi session as it appears on disk: header first, then append-only entries. */
const PI_LINES = [
  `{"type":"session","version":3,"id":"s1","timestamp":"2026-08-06T23:23:03.783Z","cwd":"/w/terax"}`,
  `{"type":"model_change","id":"a1","parentId":null,"timestamp":"2026-08-06T23:23:04.000Z","provider":"anthropic","modelId":"claude-opus-5"}`,
  `{"type":"message","id":"a2","parentId":"a1","timestamp":"2026-08-06T23:23:05.000Z","message":{"role":"user","content":[{"type":"text","text":"add a panel"}]}}`,
  `{"type":"message","id":"a3","parentId":"a2","timestamp":"2026-08-06T23:23:06.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"on it"},{"type":"toolCall","name":"read","args":{"path":"/w/a.ts"}}]}}`,
  `{"type":"message","id":"a4","parentId":"a3","timestamp":"2026-08-06T23:23:07.000Z","message":{"role":"toolResult","content":[{"type":"text","text":"file body"}]}}`,
].join("\n");

describe("parseSessionLines (pi)", () => {
  it("reads the header separately from the entries", () => {
    const parsed = parseSessionLines(PI_LINES, "pi");

    expect(parsed.header).toEqual({
      sessionId: "s1",
      cwd: "/w/terax",
      startedAt: Date.parse("2026-08-06T23:23:03.783Z"),
      parentSessionPath: null,
      name: null,
    });
    expect(parsed.nodes).toHaveLength(4);
  });

  it("classifies user turns as milestones and agent work as intermediate", () => {
    const { nodes } = parseSessionLines(PI_LINES, "pi");
    const byId = new Map(nodes.map((n) => [n.id, n]));

    expect(byId.get("a2")?.kind).toBe("user");
    expect(byId.get("a2")?.isMilestone).toBe(true);
    expect(byId.get("a3")?.kind).toBe("assistant");
    expect(byId.get("a3")?.isMilestone).toBe(false);
    expect(byId.get("a4")?.kind).toBe("toolResult");
    expect(byId.get("a1")?.kind).toBe("modelChange");
  });

  it("previews the first text block, not the thinking block", () => {
    const { nodes } = parseSessionLines(PI_LINES, "pi");
    const byId = new Map(nodes.map((n) => [n.id, n]));

    expect(byId.get("a2")?.preview).toBe("add a panel");
    expect(byId.get("a3")?.preview).toBe("on it");
  });

  it("summarises the tool calls an assistant entry issued", () => {
    const { nodes } = parseSessionLines(PI_LINES, "pi");
    const assistant = nodes.find((n) => n.id === "a3");

    expect(assistant?.toolNames).toEqual(["read"]);
  });

  it("preserves parent links and file order", () => {
    const { nodes } = parseSessionLines(PI_LINES, "pi");

    expect(nodes.map((n) => [n.id, n.parentId])).toEqual([
      ["a1", null],
      ["a2", "a1"],
      ["a3", "a2"],
      ["a4", "a3"],
    ]);
  });

  it("treats the last entry in file order as HEAD", () => {
    const { headId } = parseSessionLines(PI_LINES, "pi");

    expect(headId).toBe("a4");
  });

  it("skips blank lines, corrupt JSON and a truncated tail", () => {
    const messy = [
      `{"type":"session","version":3,"id":"s1","timestamp":"2026-08-06T23:23:03.783Z","cwd":"/w"}`,
      ``,
      `not json at all`,
      `{"type":"message","id":"b1","parentId":null,"timestamp":"2026-08-06T23:23:05.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}`,
      `{"type":"message","id":"b2","parentId":"b1","message":{"rol`,
    ].join("\n");

    const { nodes, headId } = parseSessionLines(messy, "pi");

    expect(nodes.map((n) => n.id)).toEqual(["b1"]);
    expect(headId).toBe("b1");
  });

  it("ignores entries that lack a usable id", () => {
    const lines = [
      `{"type":"message","parentId":null,"message":{"role":"user","content":[]}}`,
      `{"type":"message","id":"","parentId":null,"message":{"role":"user","content":[]}}`,
    ].join("\n");

    expect(parseSessionLines(lines, "pi").nodes).toEqual([]);
  });

  it("reads the fork pointer and the user-defined session name", () => {
    const lines = [
      `{"type":"session","version":3,"id":"s2","timestamp":"2026-07-29T10:44:07.994Z","cwd":"/w","parentSession":"/root/.pi/agent/sessions/--w--/2026-07-27_s1.jsonl"}`,
      `{"type":"session_info","id":"c1","parentId":null,"timestamp":"2026-07-29T10:44:08.000Z","name":"WORKPLACES"}`,
    ].join("\n");

    const { header, nodes } = parseSessionLines(lines, "pi");

    expect(header?.parentSessionPath).toBe(
      "/root/.pi/agent/sessions/--w--/2026-07-27_s1.jsonl",
    );
    expect(header?.name).toBe("WORKPLACES");
    expect(nodes[0]?.kind).toBe("sessionInfo");
  });

  it("keeps compaction boundaries with the entry they resume from", () => {
    const lines = [
      `{"type":"session","version":3,"id":"s1","timestamp":"2026-08-06T23:23:03.783Z","cwd":"/w"}`,
      `{"type":"compaction","id":"d1","parentId":null,"timestamp":"2026-08-06T23:24:00.000Z","summary":"## Goal\\nBuild a panel","firstKeptEntryId":"x9","tokensBefore":530692}`,
    ].join("\n");

    const { nodes } = parseSessionLines(lines, "pi");

    expect(nodes[0]?.kind).toBe("compaction");
    expect(nodes[0]?.preview).toBe("## Goal Build a panel");
    expect(nodes[0]?.compaction).toEqual({
      firstKeptEntryId: "x9",
      tokensBefore: 530692,
    });
  });

  it("records labels so the graph can show them like git tags", () => {
    const lines = [
      `{"type":"session","version":3,"id":"s1","timestamp":"2026-08-06T23:23:03.783Z","cwd":"/w"}`,
      `{"type":"message","id":"e1","parentId":null,"timestamp":"2026-08-06T23:23:05.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}`,
      `{"type":"label","id":"e2","parentId":"e1","timestamp":"2026-08-06T23:23:06.000Z","targetId":"e1","label":"before refactor"}`,
    ].join("\n");

    const { labels } = parseSessionLines(lines, "pi");

    expect(labels.get("e1")).toBe("before refactor");
  });

  it("re-chains children of a dropped entry to the nearest kept ancestor", () => {
    // `custom` is extension bookkeeping and is not rendered, but it is a real
    // tree entry: dropping it must not orphan the subtree hanging off it.
    const lines = [
      `{"type":"message","id":"h1","parentId":null,"timestamp":"2026-08-06T23:23:05.000Z","message":{"role":"user","content":[{"type":"text","text":"first"}]}}`,
      `{"type":"custom","id":"h2","parentId":"h1","timestamp":"2026-08-06T23:23:06.000Z","customType":"remote-pi:relay-state"}`,
      `{"type":"label","id":"h3","parentId":"h2","timestamp":"2026-08-06T23:23:07.000Z","targetId":"h1","label":"tag"}`,
      `{"type":"message","id":"h4","parentId":"h3","timestamp":"2026-08-06T23:23:08.000Z","message":{"role":"assistant","content":[{"type":"text","text":"second"}]}}`,
    ].join("\n");

    const { nodes } = parseSessionLines(lines, "pi");

    expect(nodes.map((n) => [n.id, n.parentId])).toEqual([
      ["h1", null],
      ["h4", "h1"],
    ]);
  });

  it("promotes a node to a root when every ancestor was dropped", () => {
    const lines = [
      `{"type":"custom","id":"i1","parentId":null,"timestamp":"2026-08-06T23:23:06.000Z","customType":"x"}`,
      `{"type":"message","id":"i2","parentId":"i1","timestamp":"2026-08-06T23:23:08.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}`,
    ].join("\n");

    const { nodes } = parseSessionLines(lines, "pi");

    expect(nodes.map((n) => [n.id, n.parentId])).toEqual([["i2", null]]);
  });

  it("lets a later empty label clear an earlier one", () => {
    const lines = [
      `{"type":"label","id":"f1","parentId":null,"timestamp":"2026-08-06T23:23:06.000Z","targetId":"z1","label":"keep"}`,
      `{"type":"label","id":"f2","parentId":"f1","timestamp":"2026-08-06T23:23:07.000Z","targetId":"z1"}`,
    ].join("\n");

    expect(parseSessionLines(lines, "pi").labels.has("z1")).toBe(false);
  });

  it("hides custom_message entries the agent marked as not displayable", () => {
    const lines = [
      `{"type":"custom_message","id":"g1","parentId":null,"timestamp":"2026-08-06T23:23:06.000Z","customType":"remote-pi:relay-state","content":"internal","display":false}`,
      `{"type":"custom_message","id":"g2","parentId":"g1","timestamp":"2026-08-06T23:23:07.000Z","customType":"plannotator","content":"a plan","display":true}`,
    ].join("\n");

    const { nodes } = parseSessionLines(lines, "pi");

    expect(nodes.map((n) => n.id)).toEqual(["g2"]);
    expect(nodes[0]?.preview).toBe("a plan");
  });
});

describe("parseSessionLines (claude)", () => {
  const CLAUDE_LINES = [
    `{"type":"user","uuid":"u1","parentUuid":null,"timestamp":"2026-07-17T11:44:37.730Z","sessionId":"cs1","cwd":"/w/f0","gitBranch":"main","message":{"role":"user","content":[{"type":"text","text":"fix the table"}]}}`,
    `{"type":"assistant","uuid":"u2","parentUuid":"u1","timestamp":"2026-07-17T11:44:40.000Z","sessionId":"cs1","message":{"role":"assistant","content":[{"type":"text","text":"looking"},{"type":"tool_use","name":"Edit","input":{"file_path":"/w/f0/a.ts"}}]}}`,
    `{"type":"user","uuid":"u3","parentUuid":"u2","timestamp":"2026-07-17T11:44:41.000Z","sessionId":"cs1","toolUseResult":{"ok":true},"message":{"role":"user","content":[{"type":"tool_result","content":"done"}]}}`,
    `{"type":"file-history-snapshot","messageId":"u1","timestamp":"2026-07-17T11:44:37.730Z","snapshot":{"messageId":"u1","trackedFileBackups":{"a.ts":{"backupFileName":"deadbeef@v2","version":2}}}}`,
  ].join("\n");

  it("normalises uuid/parentUuid into the same node shape", () => {
    const { nodes, headId } = parseSessionLines(CLAUDE_LINES, "claude");

    expect(nodes.map((n) => [n.id, n.parentId, n.kind])).toEqual([
      ["u1", null, "user"],
      ["u2", "u1", "assistant"],
      ["u3", "u2", "toolResult"],
    ]);
    expect(headId).toBe("u3");
  });

  it("reads the header from the first entry, since claude has no header line", () => {
    const { header } = parseSessionLines(CLAUDE_LINES, "claude");

    expect(header?.sessionId).toBe("cs1");
    expect(header?.cwd).toBe("/w/f0");
  });

  it("classifies a tool_result user entry as agent work, not a user milestone", () => {
    const { nodes } = parseSessionLines(CLAUDE_LINES, "claude");
    const toolResult = nodes.find((n) => n.id === "u3");

    expect(toolResult?.kind).toBe("toolResult");
    expect(toolResult?.isMilestone).toBe(false);
  });

  it("maps tool_use blocks to the same toolNames field as pi", () => {
    const { nodes } = parseSessionLines(CLAUDE_LINES, "claude");

    expect(nodes.find((n) => n.id === "u2")?.toolNames).toEqual(["Edit"]);
  });

  it("attaches code snapshots to the entry they belong to", () => {
    const { codeSnapshots } = parseSessionLines(CLAUDE_LINES, "claude");

    expect(codeSnapshots.get("u1")).toEqual(["a.ts"]);
  });

  it("marks sidechain entries so subagent work can be folded away", () => {
    const lines = [
      `{"type":"assistant","uuid":"v1","parentUuid":null,"timestamp":"2026-07-17T11:44:40.000Z","sessionId":"cs1","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"sub"}]}}`,
    ].join("\n");

    expect(parseSessionLines(lines, "claude").nodes[0]?.isSidechain).toBe(true);
  });

  it("re-chains across dropped claude bookkeeping entries", () => {
    // `system` entries sit inside the conversation chain in real transcripts,
    // so naive filtering fragmented the tree into thousands of false roots.
    const lines = [
      `{"type":"user","uuid":"x1","parentUuid":null,"timestamp":"2026-07-17T11:44:37.730Z","sessionId":"cs1","message":{"role":"user","content":[{"type":"text","text":"go"}]}}`,
      `{"type":"system","uuid":"x2","parentUuid":"x1","timestamp":"2026-07-17T11:44:38.000Z","sessionId":"cs1"}`,
      `{"type":"assistant","uuid":"x3","parentUuid":"x2","timestamp":"2026-07-17T11:44:39.000Z","sessionId":"cs1","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}`,
    ].join("\n");

    const { nodes } = parseSessionLines(lines, "claude");

    expect(nodes.map((n) => [n.id, n.parentId])).toEqual([
      ["x1", null],
      ["x3", "x1"],
    ]);
  });

  it("previews the body of a tool result instead of leaving the row blank", () => {
    // Claude carries the result body on the block's own `content` field, which
    // left a large share of rows reading "(no text)" in the panel.
    const lines = [
      `{"type":"user","uuid":"t1","parentUuid":"t0","sessionId":"cs1","message":{"role":"user","content":[{"type":"tool_result","content":"Launching skill: artifact-design"}]}}`,
    ].join("\n");

    const { nodes } = parseSessionLines(lines, "claude");

    expect(nodes[0]?.kind).toBe("toolResult");
    expect(nodes[0]?.preview).toBe("Launching skill: artifact-design");
  });

  it("prefers a real text block over a tool result body", () => {
    const lines = [
      `{"type":"user","uuid":"t2","parentUuid":"t1","sessionId":"cs1","message":{"role":"user","content":[{"type":"text","text":"said this"},{"type":"tool_result","content":"result body"}]}}`,
    ].join("\n");

    expect(parseSessionLines(lines, "claude").nodes[0]?.preview).toBe("said this");
  });

  it("marks an entry that only carried reasoning", () => {
    // 26 assistant entries in one real transcript are thinking-only; labelling
    // them "(no text)" hid what they were.
    const lines = [
      `{"type":"assistant","uuid":"t3","parentUuid":"t2","sessionId":"cs1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"weighing options"}]}}`,
    ].join("\n");

    const node = parseSessionLines(lines, "claude").nodes[0];

    expect(node?.hasReasoning).toBe(true);
    expect(node?.preview).toBe("");
  });

  it("does not mark reasoning when the entry also spoke", () => {
    const lines = [
      `{"type":"assistant","uuid":"t4","parentUuid":"t3","sessionId":"cs1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"here goes"}]}}`,
    ].join("\n");

    const node = parseSessionLines(lines, "claude").nodes[0];

    expect(node?.hasReasoning).toBe(true);
    expect(node?.preview).toBe("here goes");
  });

  it("keeps one node when the same uuid is appended twice", () => {
    // Real transcripts re-append identical entries (225 duplicated uuids in a
    // single observed file), which otherwise yields duplicate graph rows.
    const line = `{"type":"user","uuid":"y1","parentUuid":null,"timestamp":"2026-07-17T11:44:37.730Z","sessionId":"cs1","message":{"role":"user","content":[{"type":"text","text":"once"}]}}`;

    const { nodes } = parseSessionLines([line, line].join("\n"), "claude");

    expect(nodes.map((n) => n.id)).toEqual(["y1"]);
  });

  it("ignores claude bookkeeping entries that are not conversation nodes", () => {
    const lines = [
      `{"type":"ai-title","uuid":"w1","parentUuid":null,"timestamp":"2026-07-17T11:44:40.000Z","title":"x"}`,
      `{"type":"mode","uuid":"w2","parentUuid":null,"timestamp":"2026-07-17T11:44:40.000Z"}`,
      `{"type":"queue-operation","uuid":"w3","parentUuid":null,"timestamp":"2026-07-17T11:44:40.000Z"}`,
    ].join("\n");

    expect(parseSessionLines(lines, "claude").nodes).toEqual([]);
  });
});
