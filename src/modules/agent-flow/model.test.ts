import { describe, expect, it } from "vitest";
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
