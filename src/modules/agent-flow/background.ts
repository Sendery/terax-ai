import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { FlowRun, FlowTask } from "@/modules/agent-flow/model";
import type { FlowBranch } from "@/modules/agent-flow/scene";
import { native } from "@/modules/ai/lib/native";
import type { Watch } from "@/modules/watchers/lib/watch";

type NativeJob = Pick<Awaited<ReturnType<typeof native.shellBgList>>[number], "handle" | "started_at_ms">;
const NO_JOBS: NativeJob[] = [];
const JOB_REFRESH_MS = 5000;
export const BACKGROUND_GROUP = "terax:background";

export function useFlowShellJobs(open: boolean) {
  const [jobs, setJobs] = useState(NO_JOBS);
  useEffect(() => {
    if (!open || !isTauri()) return;
    let stopped = false;
    let busy = false;
    async function refresh() {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const rows = await native.shellBgList();
        const next = rows.filter((row) => !row.exited).map(({ handle, started_at_ms }) => ({ handle, started_at_ms }));
        if (!stopped) setJobs((previous) => previous.length === next.length && previous.every(
          (job, index) => job.handle === next[index].handle && job.started_at_ms === next[index].started_at_ms,
        ) ? previous : next);
      } catch {
        if (!stopped) setJobs(NO_JOBS);
      } finally {
        busy = false;
      }
    }
    void refresh();
    const tick = setInterval(refresh, JOB_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", refresh);
      setJobs(NO_JOBS);
    };
  }, [open]);
  return jobs;
}

export function backgroundBranch(watches: readonly Watch[], running: readonly string[], jobs: readonly NativeJob[]): FlowBranch | undefined {
  const runningWatches = new Set(running);
  const tasks: FlowTask[] = watches.map((watch) => {
    const seconds = watch.intervalSeconds;
    const interval = seconds % 3600 === 0 ? `${seconds / 3600} h`
      : seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
    return {
      id: `watch:${watch.id}`, label: watch.name, at: watch.createdAt,
      process: {
        kind: "monitor", state: runningWatches.has(watch.id) ? "running" : watch.enabled ? "scheduled" : "paused",
        cadence: `Every ${interval}`, lastActivityAt: watch.lastRunAt,
      },
    };
  });
  for (const { handle, started_at_ms } of jobs) {
    tasks.push({ id: `job:${handle}:${started_at_ms}`, label: `Process ${handle}`, at: started_at_ms,
      process: { kind: "background", state: "running" } });
  }
  if (!tasks.length) return undefined;
  const start = Math.min(...tasks.map((task) => task.at));
  const run: FlowRun = {
    key: BACKGROUND_GROUP, group: BACKGROUND_GROUP, tabTitle: "Terax tasks", name: "Background activity",
    agent: "terax", harness: "generic", marker: "background", startedAt: start, events: [],
  };
  return { run, tasks, start, events: [], digest: undefined, trace: undefined };
}
