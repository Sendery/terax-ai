import { describe, expect, it } from "vitest";
import { collectNodeStatus, fileCrossings, fileRelations, normalizedFile, relayGraph, resolveDeliveries, type FlowTerminal } from "@/modules/agent-flow/coordination";
import type { AgentNotification, AgentSession } from "@/modules/agents/lib/types";
import {
  beforeTime, flowTasks, historyRun, mergeRuns, sessionFamily,
} from "@/modules/agent-flow/model";
import { branchFor, contextPercent, describeActor, edgeGeometry, fitCamera, laneCamera, makeScene, overlaps, signalTone, zoomCamera } from "@/modules/agent-flow/scene";
import { buildTimeline, nearTick, timeFraction } from "@/modules/agent-flow/timeline";
import { mergeTrace, traceKey } from "@/modules/agent-flow/traceReader";

const root = historyRun({ id: "root", provider: "codex", cwd: "/project", modifiedAt: 40 }, "Project");
const child = historyRun({
  id: "child", parentId: "root", name: "Scout", provider: "codex",
  cwd: "/project", createdAt: 12, modifiedAt: 39,
}, "Project");
const grandchild = historyRun({
  id: "grandchild", parentId: "child", name: "Reviewer", provider: "codex",
  cwd: "/project", createdAt: 15, modifiedAt: 38,
}, "Project");

describe("Agent Flow", () => {
  it("keeps live tab attribution and attaches only recorded child sessions", () => {
    const live = { ...root, key: "live", active: true, group: "tab", tabTitle: "My terminal", color: "purple" as const };
    expect(mergeRuns([live], [root, child, grandchild])).toEqual([live]);
    expect(sessionFamily(live, [grandchild, child]).map(({ id, parentId, label, at }) =>
      [id, parentId, label, at])).toEqual([
      ["child", undefined, "Scout", 12],
      ["grandchild", "child", "Reviewer", 15],
    ]);
  });

  it("places actual descendants on successive layers in both directions", () => {
    const branch = branchFor(root, [child, grandchild], null, new Map());
    const down = makeScene([branch], "down").clusters[0].nodes;
    const right = makeScene([branch], "right").clusters[0].nodes;
    expect(down[0].at.y).toBeLessThan(down[1].at.y);
    expect(down[1].at.y).toBeLessThan(down[2].at.y);
    expect(right[0].at.x).toBeLessThan(right[1].at.x);
    expect(right[1].at.x).toBeLessThan(right[2].at.x);
    expect(right[2].parent).toEqual(right[1].at);
  });

  it("keeps simultaneous hierarchies on the same nonoverlapping map", () => {
    const other = historyRun({ id: "concurrent", provider: "claude", cwd: "/project", modifiedAt: 40 }, "Other tab");
    const traces = new Map([[traceKey(other) ?? "", {
      name: "Concurrent",
      events: [{ id: "d1", at: 14, kind: "delegated" as const, taskId: "one" }],
      limited: false,
      failed: false,
    }]]);
    const branches = [branchFor(root, [child, grandchild], null, traces), branchFor(other, [], null, traces)];
    const scene = makeScene(branches, "down");
    expect(scene.clusters.map(({ nodes }) => nodes.length)).toEqual([3, 2]);
    expect(overlaps(scene.clusters[0].box, scene.clusters[1].box)).toBe(false);
    const fit = fitCamera(scene, { width: 1280, height: 800 });
    expect(fit.scale * scene.height).toBeLessThan(800);
    const zoom = zoomCamera(fit, { x: 320, y: 220 }, 1.25);
    expect((320 - zoom.x) / zoom.scale).toBeCloseTo((320 - fit.x) / fit.scale);
    expect((220 - zoom.y) / zoom.scale).toBeCloseTo((220 - fit.y) / fit.scale);
  });

  it("aligns session origins on the left in rows and at the top in columns", () => {
    const other = historyRun({ id: "another", provider: "pi", cwd: "/project", modifiedAt: 40 }, "Another tab");
    const branches = [branchFor(root, [child, grandchild], null, new Map()), branchFor(other, [], null, new Map())];
    const rows = makeScene(branches, "right", "lanes");
    const [firstRow, secondRow] = rows.clusters;
    expect(firstRow.box.x).toBe(secondRow.box.x);
    expect(firstRow.box.y + firstRow.box.height).toBeLessThan(secondRow.box.y);
    expect(firstRow.nodes[0].at.x).toBe(secondRow.nodes[0].at.x);
    expect(firstRow.nodes[1].at.x).toBeGreaterThan(firstRow.nodes[0].at.x);
    expect(laneCamera(rows, { width: 200, height: 200 })).toMatchObject({ x: 0, y: 0 });

    const columns = makeScene(branches, "down", "lanes");
    const [firstColumn, secondColumn] = columns.clusters;
    expect(firstColumn.box.y).toBe(secondColumn.box.y);
    expect(firstColumn.box.x + firstColumn.box.width).toBeLessThan(secondColumn.box.x);
    expect(firstColumn.nodes[0].at.y).toBe(secondColumn.nodes[0].at.y);
    expect(laneCamera(columns, { width: 200, height: 800 }).x).toBe(0);
  });

  it("points the horizontal connection right for delegation and left for its return", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 352, y: 0 };
    const delegation = edgeGeometry(from, to, "right", false);
    const result = edgeGeometry(from, to, "right", true);
    const path = delegation.d.split(" ");
    const start = Number(path[1]);
    const end = Number(path[path.length - 2]);
    expect(start).toBeLessThan(end);
    expect(delegation.arrow).toContain(`M ${end - 7} 51 L ${end} 55`);
    expect(result.arrow).toContain(`M ${start + 7} 51 L ${start} 55`);
  });

  it("keeps separate shell tracks for split panes and combines runs from the same shell", () => {
    const first = { ...root, group: "one-tab", leafId: 1, active: true, createdAt: 10, shellKey: "one-tab:1" };
    const archived = { ...root, key: "prior-run", createdAt: 5, shellKey: "one-tab:1" };
    const split = {
      ...root, key: "split", group: "one-tab", leafId: 2, createdAt: 20,
      events: [{ id: "tool", at: 40, kind: "tool" as const }],
    };
    const traces = new Map();
    const timeline = buildTimeline([
      branchFor(first, [child], null, traces),
      branchFor(archived, [], null, traces),
      branchFor(split, [], null, traces),
    ], traces);
    expect(timeline.lanes.map(({ key, marks }) => [key, marks.map(({ at }) => at)])).toEqual([
      ["one-tab:1", [5, 10, 12]],
      ["one-tab:2", [20, 40]],
    ]);
    expect(timeline.marks.map(({ at }) => at)).toEqual([5, 10, 12, 20, 40]);
    expect(timeFraction(12, 5, 40)).toBe(0.2);
    expect(nearTick(timeline.lanes[1].marks, 17)?.at).toBe(20);
    expect(nearTick([], 17)).toBeUndefined();
  });

  it("keeps pending split shells distinct and only attaches matching terminal notifications", () => {
    const pane = (leafId: number, lastReason: AgentSession["lastReason"]): FlowTerminal => ({
      leafId, slot: leafId, tabId: 1, title: "Mixed CLIs", shellKey: `shell:${leafId}`, split: true,
      runKey: `run:${leafId}`,
      session: {
        leafId, tabId: 1, agent: leafId === 1 ? "codex" : "claude", status: lastReason ? "waiting" : "working",
        startedAt: 4, lastActivityAt: 20, attentionSince: lastReason ? 10 : null, lastSignal: lastReason ? "attention" : "working",
        lastReason, sessionId: null, ptyId: leafId, integration: "pty-detection", harness: "generic",
      },
    });
    const panes = [pane(1, "permission"), pane(2, "question"), pane(3, null)];
    const runs = panes.map(({ shellKey, runKey }) => ({ ...root, key: runKey ?? "", shellKey, startedAt: 4 }));
    const notice = (leafId: number, at: number, extra: Partial<AgentNotification> = {}): AgentNotification => ({
      source: "terminal", tabId: 1, leafId, at, id: `notice:${leafId}:${at}`, agent: "claude",
      kind: "attention", tone: "question", reason: "question", tabTitle: "Mixed CLIs", tabColor: null, read: false, ...extra,
    });
    const statuses = collectNodeStatus(panes, runs, [
      notice(1, 3), notice(2, 12), notice(2, 13, { source: "local" }), notice(3, 15, { tabId: 2 }),
    ]);
    expect(statuses.get("run:1")).toEqual({ pending: "Permission required", notice: undefined });
    expect(statuses.get("run:2")).toMatchObject({ pending: "Question waiting", notice: { id: "notice:2:12", tone: "question" } });
    expect(statuses.has("run:3")).toBe(false);
  });

  it("resolves explicit deliveries to the recorded session and excludes private endpoints", () => {
    const source = { ...root, key: "source", shellKey: "a", createdAt: 4 };
    const target = { ...root, key: "target", shellKey: "b", createdAt: 5 };
    const delivery = {
      id: "one", at: 12, submitted: true,
      source: { shellKey: "a", runKey: "source" }, target: { shellKey: "b", runKey: "target" },
    };
    const observed = resolveDeliveries([delivery], [], [source, target], new Set(), null);
    expect(observed.map(({ from, to }) => [from?.run?.key, to.run?.key])).toEqual([["source", "target"]]);
    expect(resolveDeliveries([delivery], [], [source, target], new Set(["a"]), null)).toEqual([]);
    expect(resolveDeliveries([delivery], [], [source, target], new Set(), 11)).toEqual([]);
    const timeline = buildTimeline([branchFor(source, [], null, new Map()), branchFor(target, [], null, new Map())], new Map(), observed);
    expect(timeline.lanes.map(({ marks }) => marks[marks.length - 1])).toEqual([
      { at: 12, kind: "delivery" }, { at: 12, kind: "delivery" },
    ]);
  });

  it("links Terax to a public shell with no transcript without adding a Terax track", () => {
    const pane: FlowTerminal = { tabId: 15, leafId: 1, shellKey: "launch:15:1", title: "Shell", slot: 1, split: false };
    const delivery = { id: "relay", at: 18, submitted: true, target: { shellKey: pane.shellKey } };
    const resolved = resolveDeliveries([delivery], [pane], [], new Set(), null);
    const graph = relayGraph(resolved, [], "");
    expect(graph.links).toMatchObject([{ from: "flow:terax", to: `shell:${pane.shellKey}`, kind: "relay" }]);
    expect(graph.markers.map(({ marker }) => marker)).toEqual(["terax", "shell"]);
    const traces = new Map();
    const timeline = buildTimeline(graph.markers.map((run) => branchFor(run, [], null, traces)), traces, resolved);
    expect(timeline.lanes.map(({ key }) => key)).toEqual([pane.shellKey]);
    expect(timeline.marks).toEqual([{ at: 18, kind: "delivery" }]);
    expect(relayGraph(resolved, [], "launch:other").links).toEqual([]);
  });

  it("links explicit writes and reads across sessions and excludes read-only pairs and sibling checkouts", () => {
    const write = { id: "tool", at: 12, kind: "tool" as const, text: "Write", file: "./src/../main.ts" };
    const runs = [
      { ...root, key: "one", events: [write] },
      { ...root, key: "two", events: [{ ...write, at: 15, file: "/project/main.ts", text: "edit_file" }] },
      { ...root, key: "reader", events: [{ ...write, at: 16, text: "Read" }] },
      { ...root, key: "other-checkout", cwd: "/project-2", events: [write] },
      { ...root, key: "reader-a", events: [{ ...write, file: "read-only.ts", text: "Read" }] },
      { ...root, key: "reader-b", events: [{ ...write, file: "read-only.ts", text: "Read" }] },
    ];
    const branches = runs.map((run) => branchFor(run, [], null, new Map()));
    expect(fileCrossings(branches, new Map(), 14)).toEqual([]);
    expect(fileCrossings(branches, new Map(), null).map(({ path, touches }) =>
      [path, touches.map(({ run, operation }) => [run.key, operation])])).toEqual([
      ["/project/main.ts", [["reader", "read"], ["two", "write"], ["one", "write"]]],
    ]);
    expect(fileRelations(fileCrossings(branches, new Map(), null))).toMatchObject([
      { from: "one", to: "reader", kind: "file" }, { from: "one", to: "two", kind: "file" },
    ]);
    expect(normalizedFile("/project", "../outside.ts")).toBeUndefined();
    expect(normalizedFile("C:\\work", "src\\main.ts")).toBe("C:/work/src/main.ts");
  });

  it("keeps incremental traces stable and uses deduplicated usage at the playhead", () => {
    const first = { id: "u1", at: 10, kind: "usage" as const, usage: { key: "a", tokens: 58, cumulative: false } };
    const last = { id: "u2", at: 20, kind: "usage" as const, usage: { key: "a", tokens: 73, cumulative: false, context: { input: 64, window: 100 } } };
    const empty = { events: [], name: null, nextOffset: 10, reset: false, limited: false };
    const trace = mergeTrace(undefined, { ...empty, events: [first, last] });
    expect(mergeTrace(trace, empty)).toBe(trace);
    const branch = branchFor(root, [], null, new Map([[traceKey(root) ?? "", trace]]));
    expect(describeActor(branch, undefined, trace, 15).usage?.tokens).toBe(58);
    const usage = describeActor(branch, undefined, trace, null).usage;
    expect(usage?.tokens).toBe(73);
    expect(usage?.context && contextPercent(usage.context)).toBe(64);
    expect(contextPercent({ input: 120, window: 100 })).toBe(100);
  });

  it("marks recorded delegation and return signals on a subagent without a transcript", () => {
    const events = [
      { id: "1", at: 10, kind: "delegated" as const, taskId: "child" },
      { id: "2", at: 12, kind: "reply" as const, text: "Parent reply" },
      { id: "3", at: 14, kind: "returned" as const, taskId: "child" },
    ];
    const trace = { events, name: null, limited: false, failed: false };
    const run = historyRun({ id: "solo", provider: "claude", cwd: "/project", modifiedAt: 40 }, "Project");
    const branch = branchFor(run, [], null, new Map([[traceKey(run) ?? "", trace]]));
    const actor = describeActor(branch, branch.tasks[0], undefined, null);
    expect(actor.signals.map((event) => signalTone(event.kind))).toEqual(["branch", "return"]);
    expect(actor.speech).toBeUndefined();
    expect(describeActor(branch, branch.tasks[0], undefined, 12).signals.map(({ id }) => id)).toEqual(["1"]);
  });

  it("rewinds a delegation independently of its result", () => {
    const events = [
      { id: "1", at: 10, kind: "delegated" as const, taskId: "sub", text: "Inspect" },
      { id: "2", at: 12, kind: "returned" as const, taskId: "another-tool" },
      { id: "3", at: 15, kind: "returned" as const, taskId: "sub" },
    ];
    expect(flowTasks(beforeTime(events, 12))).toEqual([{ id: "sub", at: 10, label: "Inspect" }]);
    expect(flowTasks(events)).toEqual([{ id: "sub", at: 10, label: "Inspect", returnedAt: 15 }]);
  });
});
