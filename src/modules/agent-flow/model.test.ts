import { describe, expect, it } from "vitest";
import {
  beforeTime, flowTasks, historyRun, mergeRuns, sessionFamily,
} from "@/modules/agent-flow/model";
import { branchFor, contextPercent, describeActor, fitCamera, makeScene, overlaps, signalTone, zoomCamera } from "@/modules/agent-flow/scene";
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
    const left = makeScene([branch], "left").clusters[0].nodes;
    expect(down[0].at.y).toBeLessThan(down[1].at.y);
    expect(down[1].at.y).toBeLessThan(down[2].at.y);
    expect(left[0].at.x).toBeGreaterThan(left[1].at.x);
    expect(left[1].at.x).toBeGreaterThan(left[2].at.x);
    expect(left[2].parent).toEqual(left[1].at);
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
