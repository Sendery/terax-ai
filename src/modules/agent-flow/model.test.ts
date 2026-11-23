import { describe, expect, it } from "vitest";
import {
  beforeTime, flowTasks, historyRun, mergeRuns, placeLane, sessionFamily,
} from "@/modules/agent-flow/model";

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
    const family = sessionFamily(root, [child, grandchild]);
    const down = placeLane(family, "down");
    const left = placeLane(family, "left");
    expect(down.root.y).toBeLessThan(down.positions.get("child")?.y ?? 0);
    expect(down.positions.get("child")?.y).toBeLessThan(down.positions.get("grandchild")?.y ?? 0);
    expect(left.root.x).toBeGreaterThan(left.positions.get("child")?.x ?? Infinity);
    expect(left.positions.get("child")?.x).toBeGreaterThan(left.positions.get("grandchild")?.x ?? Infinity);
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
