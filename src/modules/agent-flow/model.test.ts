import { describe, expect, it } from "vitest";
import { collectNodeStatus, fileCrossings, fileRelations, normalizedFile, relayGraph, resolveDeliveries, type FlowTerminal } from "@/modules/agent-flow/coordination";
import type { AgentNotification, AgentSession, SessionDigest } from "@/modules/agents/lib/types";
import { backgroundBranch } from "@/modules/agent-flow/background";
import { currentSourceFilter, sourceGroups, sourceMatches, type SourceFilter } from "@/modules/agent-flow/FlowSourceFilter";
import {
  beforeTime, flowTasks, historyRun, mergeRuns, sessionFamily, type FlowRun,
} from "@/modules/agent-flow/model";
import {
  branchFor, COMPACT_SCALE, contextPercent, describeActor, edgeGeometry, fitCamera, fitFlowCamera,
  laneCamera, liveBranches, makeScene, nodeGeometry, overlaps, signalTone, zoomCamera, zoomFlowCamera,
} from "@/modules/agent-flow/scene";
import { buildTimeline, nearTick, timeFraction } from "@/modules/agent-flow/timeline";
import { mergeTrace, traceKey, type FlowTrace } from "@/modules/agent-flow/traceReader";
import { createWatch } from "@/modules/watchers/lib/watch";

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
  it("groups live shells by tab identity and distinguishes a full tab from chosen shells", () => {
    const pane = { leafId: 1, tabId: 3, shellKey: "launch:3:1", title: "Review", slot: 1, split: true };
    const sibling = { ...pane, leafId: 2, shellKey: "launch:3:2", slot: 2 };
    const other = { ...pane, tabId: 4, shellKey: "launch:4:3", leafId: 3 };
    const groups = sourceGroups([pane, sibling, other], [{ ...root, group: "launch:3" }]);
    expect(groups.map(({ title, shells }) => [title, shells.length])).toEqual([["Review · 1", 2], ["Review · 2", 1]]);
    const chosen: SourceFilter = new Map([["launch:3", new Set([sibling.shellKey])]]);
    const partial = currentSourceFilter(chosen, groups);
    expect(sourceMatches(partial, "launch:3", pane.shellKey)).toBe(false);
    expect(sourceMatches(partial, "launch:3", sibling.shellKey)).toBe(true);
    expect(currentSourceFilter(chosen, sourceGroups([pane, other], [])).size).toBe(0);
    const full = currentSourceFilter(new Map([["launch:3", null]]), groups);
    expect(sourceMatches(full, "launch:3", "launch:3:5")).toBe(true);
    expect(sourceMatches(full, "launch:4", other.shellKey)).toBe(false);
  });

  it("keeps live tab attribution and attaches only recorded child sessions", () => {
    const live = { ...root, key: "live", active: true, group: "tab", tabTitle: "My terminal", color: "purple" as const };
    expect(mergeRuns([live], [root, child, grandchild])).toEqual([live]);
    expect(sessionFamily(live, [grandchild, child]).map(({ id, parentId, label, at }) =>
      [id, parentId, label, at])).toEqual([
      ["child", undefined, "Scout", 12],
      ["grandchild", "child", "Reviewer", 15],
    ]);
  });

  it("combines a Codex spawn and wait result with the child's tools and usage", () => {
    const live = { ...root, active: true };
    const traces = new Map<string, FlowTrace>([
      [traceKey(live) ?? "", { name: null, limited: false, failed: false, events: [
        { id: "call", at: 10, kind: "delegated", taskId: "tool-call" },
        { id: "link", at: 12, kind: "task-alias", taskId: "tool-call", text: "review" },
        { id: "thread", at: 13, kind: "task-alias", taskId: "review", text: "child" },
        { id: "started-child", at: 14, kind: "delegated", taskId: "child" },
        { id: "wait", at: 20, kind: "returned", taskId: "child" },
      ] }],
      [traceKey(child) ?? "", { name: null, limited: false, failed: false, events: [
        { id: "inherited", at: 9, kind: "tool", text: "Parent tool" },
        { id: "tool", at: 14, kind: "tool", text: "exec_command" },
        { id: "tokens", at: 16, kind: "usage", usage: { tokens: 87, cumulative: true } },
      ] }],
    ]);
    const branch = branchFor(live, [child], null, traces);
    expect(branch.tasks).toHaveLength(1);
    expect(branch.tasks[0]).toMatchObject({ id: "child", at: 10, returnedAt: 20, label: "Scout" });
    const actor = describeActor(branch, branch.tasks[0], traces.get(traceKey(child) ?? ""), null);
    expect(actor.tools.map(({ text }) => text)).toEqual(["exec_command"]);
    expect(actor.usage?.tokens).toBe(87);
    const timeline = buildTimeline([branch], traces);
    expect(timeline.marks).toContainEqual({ at: 14, kind: "tool" });
    expect(timeline.marks).not.toContainEqual({ at: 9, kind: "tool" });
  });

  it("keeps Terax AI's inline subagent usage and tools separate from its parent", () => {
    const run: FlowRun = {
      ...root, harness: "generic", agent: "terax", events: [
        { id: "spawn", at: 11, kind: "delegated", taskId: "sub" },
        { id: "child-tool", at: 12, kind: "tool", taskId: "sub", text: "Search" },
        { id: "child-usage", at: 13, kind: "usage", taskId: "sub", usage: { tokens: 17, cumulative: false } },
        { id: "root-usage", at: 14, kind: "usage", usage: { tokens: 37, cumulative: true } },
      ],
    };
    const branch = branchFor(run, [], null, new Map());
    expect(describeActor(branch, undefined, undefined, null).usage?.tokens).toBe(37);
    const actor = describeActor(branch, branch.tasks[0], undefined, null);
    expect(actor.usage?.tokens).toBe(17);
    expect(actor.tools.map(({ text }) => text)).toEqual(["Search"]);
  });

  it("marks the part of Copilot's subagent usage included in the session total", () => {
    const run: FlowRun = {
      ...root, harness: "copilot", events: [
        { id: "spawn", at: 10, kind: "delegated", taskId: "child" },
        { id: "child-usage", at: 11, kind: "usage", taskId: "child", usage: { tokens: 32, cumulative: false, outputOnly: true } },
        { id: "checkpoint", at: 12, kind: "usage", usage: { tokens: 112, cumulative: true, includesSubagents: true } },
      ],
    };
    const branch = branchFor(run, [], null, new Map());
    expect(describeActor(branch, undefined, undefined, 11).usage).toBeUndefined();
    expect(describeActor(branch, undefined, undefined, null).usage).toMatchObject({ tokens: 112, subagentsThrough: 12 });
    expect(describeActor(branch, branch.tasks[0], undefined, null).usage).toMatchObject({ tokens: 32, outputOnly: true });
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

  it.each(["down", "right"] as const)("fits compact %s lanes to their own content", (direction) => {
    const other = { ...root, key: "short", sessionId: "short" };
    const branches = [branchFor(root, [child, grandchild], null, new Map()), branchFor(other, [], null, new Map())];
    const expanded = makeScene(branches, direction, "lanes");
    const compact = makeScene(branches, direction, "lanes", true);
    const [long, short] = compact.clusters;
    const depth = direction === "down" ? "height" : "width";
    expect(short.box[depth]).toBeLessThan(long.box[depth]);
    expect(short.box.width).toBeLessThan(expanded.clusters[1].box.width);
    expect(overlaps(long.box, short.box)).toBe(false);
    expect(long.nodes[2].parent).toEqual(long.nodes[1].at);
  });

  it.each(["down", "right"] as const)("places the coordinator before all %s terminal lanes", (direction) => {
    const other = { ...root, key: "short", sessionId: "short" };
    const tabs = [branchFor(root, [child, grandchild], null, new Map()), branchFor(other, [], null, new Map())];
    const coordinator = branchFor({ ...root, key: "flow:terax", marker: "terax" }, [], null, new Map());
    for (const compact of [false, true]) {
      const scene = makeScene([...tabs, coordinator], direction, "lanes", compact);
      const [rail, first, second] = scene.clusters;
      expect(rail.branch.run.key).toBe("flow:terax");
      const leadingAxis = direction === "down" ? "y" : "x";
      const depth = direction === "down" ? "height" : "width";
      const across = direction === "down" ? "x" : "y";
      const extent = direction === "down" ? "width" : "height";
      expect(rail.box[leadingAxis] + rail.box[depth]).toBeLessThan(Math.min(first.box[leadingAxis], second.box[leadingAxis]));
      expect(rail.box[across]).toBeLessThanOrEqual(Math.min(first.box[across], second.box[across]));
      expect(rail.box[across] + rail.box[extent]).toBeGreaterThanOrEqual(Math.max(first.box[across] + first.box[extent], second.box[across] + second.box[extent]));
      expect(first.box[leadingAxis]).toBe(second.box[leadingAxis]);
      expect(overlaps(first.box, second.box)).toBe(false);
    }
  });

  it("fits the compact layout without crossing the detail threshold and anchors zoom to the same node", () => {
    const direction = "right";
    const branches = [branchFor(root, [child, grandchild], null, new Map())];
    const expanded = makeScene(branches, direction);
    const compact = makeScene(branches, direction, "fit", true);
    const layouts = { expanded, compact };
    const fit = fitFlowCamera(layouts, { width: 540, height: 460 });
    expect(fit.scale).toBeLessThan(COMPACT_SCALE);
    expect(compact.width * fit.scale).toBeLessThan(540);
    const anchor = (scene: typeof expanded, overview: boolean) => {
      const { box, nodes } = scene.clusters[0];
      const { centerX, centerY } = nodeGeometry(direction, overview);
      return { x: box.x + nodes[1].at.x + centerX, y: box.y + nodes[1].at.y + centerY };
    };
    const camera = { x: 15, y: 30, scale: 0.55 };
    const start = anchor(expanded, false);
    const point = { x: start.x * camera.scale + camera.x, y: start.y * camera.scale + camera.y };
    const zoom = zoomFlowCamera(camera, point, 0.8, layouts, direction, null);
    const target = anchor(compact, true);
    expect(target.x * zoom.scale + zoom.x).toBeCloseTo(point.x);
    expect(target.y * zoom.scale + zoom.y).toBeCloseTo(point.y);
    const restored = zoomFlowCamera(zoom, point, 1.25, layouts, direction, null);
    expect(restored.x).toBeCloseTo(camera.x);
    expect(restored.y).toBeCloseTo(camera.y);
    expect(edgeGeometry(compact.clusters[0].nodes[0].at, compact.clusters[0].nodes[1].at, direction, false, true).d)
      .toBe("M 125 91 H 249");
  });

  it("keeps same-row connections straight with delegation and return arrows at node height", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 352, y: 0 };
    const delegation = edgeGeometry(from, to, "right", false);
    const result = edgeGeometry(from, to, "right", true);
    expect(delegation.d).toBe("M 76 73 H 370");
    expect(result.d).toBe(delegation.d);
    expect(delegation.arrow).toBe("M 363 69 L 370 73 L 363 77");
    expect(result.arrow).toBe("M 83 69 L 76 73 L 83 77");
  });

  it("curves between rows beyond the source card, with the compact curve starting at the beacon", () => {
    const from = { x: 0, y: 0 };
    const branch = edgeGeometry(from, { x: 352, y: 150 }, "right", false);
    expect(branch.d).toBe("M 76 73 H 332 C 348 73, 354 223, 370 223");
    const compact = edgeGeometry(from, { x: 182, y: 144 }, "right", true, true);
    expect(compact.d).toBe("M 107 42 C 159 42, 179 186, 231 186");
    expect(compact.arrow).toBe("M 114 38 L 107 42 L 114 46");
  });

  it.each([false, true])("wraps seven siblings across two columns with a clear path to the farther column (compact=%s)", (compact) => {
    const branch = branchFor(root, [], null, new Map());
    branch.tasks = Array.from({ length: 7 }, (_, i) => ({ id: `sibling-${i}`, label: `Review ${i}`, at: i + 11 }));
    branch.tasks.push({ id: "follow-up", parentId: "sibling-0", label: "Follow-up", at: 22 });
    const { nodes, channel, box } = makeScene([branch], "right", "fit", compact).clusters[0];
    const siblings = nodes.slice(1, 8);
    const firstColumn = siblings.filter(({ at }) => at.x === siblings[0].at.x);
    const secondColumn = siblings.filter(({ at }) => at.x === siblings[6].at.x);
    const followUp = nodes[8];
    expect([firstColumn.length, secondColumn.length]).toEqual([4, 3]);
    expect(box.height).toBeLessThan(5 * (nodeGeometry("right", compact).height + 20));
    expect(siblings.every(({ parent }) => parent === nodes[0].at)).toBe(true);
    expect(followUp.parent).toBe(siblings[0].at);
    expect(followUp.at.x).toBeGreaterThan(secondColumn[0].at.x);
    expect(channel?.y).toBe(nodes[0].at.y + nodeGeometry("right", compact).centerY);
    expect(channel?.y).toBeGreaterThan(firstColumn[1].at.y + nodeGeometry("right", compact).height);
    expect(channel?.y).toBeLessThan(firstColumn[2].at.y - (compact ? 0 : 44));
    expect(edgeGeometry(nodes[0].at, secondColumn[0].at, "right", false, compact, channel).d)
      .toContain(` H ${firstColumn[0].at.x + nodeGeometry("right", compact).width + 6} C `);
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
    const runs = panes.map(({ shellKey, runKey }) => ({ ...root, key: runKey ?? "", shellKey, startedAt: 4, active: true }));
    const notice = (leafId: number, at: number, extra: Partial<AgentNotification> = {}): AgentNotification => ({
      source: "terminal", tabId: 1, leafId, at, id: `notice:${leafId}:${at}`, agent: "claude",
      kind: "attention", tone: "question", reason: "question", tabTitle: "Mixed CLIs", tabColor: null, read: false, ...extra,
    });
    const statuses = collectNodeStatus(panes, runs, [
      notice(1, 3), notice(2, 12), notice(2, 13, { source: "local" }), notice(3, 15, { tabId: 2 }),
    ]);
    expect(statuses.get("run:1")).toEqual({ pending: "Permission required", notice: undefined });
    expect(statuses.get("run:2")).toMatchObject({ pending: "Question waiting", notice: { id: "notice:2:12", tone: "question" } });
    expect(statuses.get("run:3")).toEqual({ pending: undefined, notice: undefined, working: true });
    expect(collectNodeStatus(panes, [{ ...runs[2], active: false }], []).has("run:3")).toBe(false);
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
    const graph = relayGraph(resolved, [], new Set());
    expect(graph.links).toMatchObject([{ from: "flow:terax", to: `shell:${pane.shellKey}`, kind: "relay" }]);
    expect(graph.markers.map(({ marker }) => marker)).toEqual(["terax", "shell"]);
    const traces = new Map();
    const timeline = buildTimeline(graph.markers.map((run) => branchFor(run, [], null, traces)), traces, resolved);
    expect(timeline.lanes.map(({ key }) => key)).toEqual([pane.shellKey]);
    expect(timeline.marks).toEqual([{ at: 18, kind: "delivery" }]);
    expect(relayGraph(resolved, [], new Set(["launch:other"])).links).toEqual([]);
    expect(relayGraph(resolved, [], new Set(["launch:15", "launch:other"])).links).toHaveLength(1);
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

  it("joins live process information to recorded tasks and preserves replay boundaries", () => {
    const run = { ...root, harness: "claude" as const, startedAt: 20_000, leafId: 11, active: true };
    run.events = [
      { id: "m", at: 21_000, kind: "monitor-started", taskId: "monitor", text: "Review status" },
      { id: "a", at: 26_000, kind: "task-activity", taskId: "monitor" },
      { id: "b", at: 23_000, kind: "background-started", taskId: "script", text: "Package build" },
      { id: "x", at: 27_000, kind: "error", taskId: "script" },
    ];
    const digest: SessionDigest = {
      sessionId: "root", name: null, recap: null, recapAt: null, lastReply: null, lastReplyAt: null,
      goal: null, pendingQuestion: null, prs: [], artifacts: [],
      tasks: [
        { id: "monitor", kind: "monitor", label: "Review status", startedAt: 21_000, lastActivityAt: 28_000 },
        { id: "old", kind: "background", label: "Prior process", startedAt: 1 },
      ],
    };
    const branch = branchFor(run, [], { 11: digest }, new Map());
    expect(branch.tasks.map(({ id }) => id)).toEqual(["monitor", "script"]);
    const [monitor, script] = branch.tasks;
    expect(describeActor(branch, monitor, undefined, null)).toMatchObject({ label: "Listening", activity: { at: 28_000 } });
    expect(describeActor(branch, monitor, undefined, 27_000)).toMatchObject({ label: "Recorded", activity: { at: 26_000 } });
    expect(describeActor(branch, script, undefined, null)).toMatchObject({ label: "Failed", tone: "error" });
  });

  it("puts registered watches and native background jobs on a separate activity track", () => {
    const watch = createWatch({ name: "PR status", command: "check", intervalSeconds: 60, onChange: "notify" }, "pr", 100);
    const branch = backgroundBranch([{ ...watch, lastRunAt: 160 }], ["pr"], [{ handle: 7, started_at_ms: 120 }]);
    if (!branch) throw new Error("Background branch missing");
    expect(branch.tasks[0].process).toEqual({ kind: "monitor", state: "running", cadence: "Every 1 min", lastActivityAt: 160 });
    expect(buildTimeline([branch], new Map()).lanes[0]).toMatchObject({ title: "Terax tasks", active: true, marks: [
      { at: 100, kind: "monitor-started" }, { at: 120, kind: "background-started" }, { at: 160, kind: "task-activity" },
    ] });
  });

  it("retires finished and stale tasks from live layout while keeping history and active ancestry", () => {
    const branch = branchFor(root, [], null, new Map());
    branch.tasks = [
      { id: "done", at: 10, label: "Returned", returnedAt: 1000 },
      { id: "old", at: 10, label: "Stale" },
      { id: "parent", at: 10, label: "Parent", returnedAt: 20 },
      { id: "child", at: 10, label: "Busy", parentId: "parent", running: true },
      { id: "watch", at: 10, label: "Listening", process: { kind: "monitor", state: "listening" } },
      { id: "paused", at: 10, label: "Paused", process: { kind: "monitor", state: "paused" } },
    ];
    const early = liveBranches([branch], new Map(), 2000, null);
    expect(early.nextExpiry).toBe(30_020);
    const next = liveBranches([branch], new Map(), 400_000, null);
    expect(next.branches[0].tasks.map(({ id }) => id)).toEqual(["parent", "child", "watch"]);
    const selected = liveBranches([branch], new Map(), 400_000, { run: root.key, task: "done" });
    expect(selected.branches[0].tasks.some(({ id }) => id === "done")).toBe(true);
    expect(buildTimeline([branch], new Map()).marks).toContainEqual({ at: 1000, kind: "returned" });
  });

  it("ends a background task by its provider alias even with a stale digest", () => {
    const run = { ...root, harness: "claude" as const, active: true, leafId: 11, startedAt: 20 };
    const trace = { name: null, failed: false, limited: false, events: [
      { id: "1", at: 21, kind: "background-started" as const, taskId: "call" },
      { id: "2", at: 22, kind: "task-alias" as const, taskId: "call", text: "background-id" },
      { id: "3", at: 23, kind: "returned" as const, taskId: "background-id" },
    ] };
    const branch = branchFor(run, [], { 11: {
      sessionId: "root", name: null, recap: null, recapAt: null, lastReply: null, lastReplyAt: null,
      goal: null, pendingQuestion: null, prs: [], artifacts: [],
      tasks: [{ id: "call", kind: "background", label: "Build helper", startedAt: 21 }],
    } }, new Map([[traceKey(run) ?? "", trace]]));
    expect(branch.tasks[0]).toMatchObject({ id: "call", returnedAt: 23 });
    expect(liveBranches([branch], new Map(), 31_000, null).branches[0].tasks).toEqual([]);
    expect(buildTimeline([branch], new Map()).marks).toContainEqual({ at: 23, kind: "returned" });
  });

  it("retires completed Codex descendants and ignores late PTY working noise on the parent", () => {
    const run = { ...root, active: true, startedAt: 10, events: [{ id: "pty", at: 25, kind: "working" as const }] };
    const trace = { name: null, failed: false, limited: false, events: [
      { id: "end", at: 20, kind: "turn-ended" as const },
      { id: "reply", at: 21, kind: "reply" as const, text: "Done" },
    ] };
    const traces = new Map<string, FlowTrace>([[traceKey(run) ?? "", trace], [traceKey(child) ?? "", trace]]);
    const branch = branchFor(run, [child], null, traces);
    expect(describeActor(branch, undefined, trace, null).label).toBe("Turn complete");
    expect(branch.tasks[0].returnedAt).toBe(20);
    expect(liveBranches([branch], traces, 31_000, null).branches[0].tasks).toEqual([]);
    expect(liveBranches([branch], traces, 31_000, null, true).branches).toEqual([]);
    expect(liveBranches([branch], traces, 31_000, { run: run.key }, true).branches).toHaveLength(1);
    const next = { ...trace, events: [...trace.events, { id: "new", at: 31_001, kind: "user" as const }] };
    traces.set(traceKey(run) ?? "", next);
    expect(liveBranches([branchFor(run, [child], null, traces)], traces, 31_002, null, true).branches).toHaveLength(1);
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
