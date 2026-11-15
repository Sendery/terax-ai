import { expect, it } from "vitest";
import { createTask } from "@/modules/tasks/lib/task";
import {
  createdTaskSessionPatch,
  dispatchedTaskPatch,
} from "@/modules/tasks/lib/deliveryState";
function task() {
  return createTask(
    {
      name: "Public",
      prompt: "go",
      cwd: "/repo",
      schedule: { kind: "manual" },
    },
    100,
  );
}
it("counts an attempt without claiming that a session was created", () => {
  const value = task();
  expect(dispatchedTaskPatch(value, 200)).toEqual({
    lastRunAt: 200,
    runCount: 1,
  });
  expect(value.sessions).toEqual([]);
});
it("records only the confirmed session without recounting the occurrence", () => {
  const value = task();
  value.cwd = "/run-directory";
  const patch = createdTaskSessionPatch(
    value,
    "known-session",
    "/run-directory",
    value.seed,
  );
  expect(patch).toEqual({
    sessions: [{ id: "known-session", cwd: "/run-directory" }],
  });
  expect(value.runCount).toBe(0);
  if (!patch) throw new Error("patch");
  value.sessions = patch.sessions;
  expect(
    createdTaskSessionPatch(
      value,
      "known-session",
      "/run-directory",
      value.seed,
    ),
  ).toBeNull();
});
it("does not carry conversation context across routine runs", () => {
  const value = task();
  value.mode = "routine";
  expect(
    createdTaskSessionPatch(value, "known-session", "/repo", value.seed),
  ).toBeNull();
});

it("cannot reinsert an acknowledged session from an older conversation generation", () => {
  const value = task();
  const original = value.seed;
  value.seed = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  value.sessions = [];
  expect(
    createdTaskSessionPatch(value, "old-session", "/repo", original),
  ).toBeNull();
  expect(value.sessions).toEqual([]);
});

it("does not bind a previous run's directory to a retargeted task", () => {
  const value = task();
  expect(
    createdTaskSessionPatch(value, "old-session", "/old-directory", value.seed),
  ).toBeNull();
});
