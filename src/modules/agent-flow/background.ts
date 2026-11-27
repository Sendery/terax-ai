import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { FlowRun, FlowTask } from "@/modules/agent-flow/model";
import type { FlowBranch } from "@/modules/agent-flow/scene";
import { native } from "@/modules/ai/lib/native";
import type { Watch } from "@/modules/watchers/lib/watch";
import { useWatchStore } from "@/modules/watchers/lib/watchStore";

type NativeJob = {
  handle: number;
  started_at_ms: number;
  endedAt?: number;
  failed?: boolean;
};
const NO_JOBS: NativeJob[] = [];
const JOB_REFRESH_MS = 5000;
export const BACKGROUND_GROUP = "terax:background";

function useFlowShellJobs(open: boolean) {
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
        const next = rows.filter((row) => !row.exited || row.exited_at_ms != null)
          .map(({ handle, started_at_ms, exited_at_ms, exited, exit_code }) => ({
            handle, started_at_ms, endedAt: exited_at_ms ?? undefined,
            failed: exited && exit_code !== 0,
          }));
        if (!stopped) setJobs((previous) => previous.length === next.length && previous.every(
          (job, index) => job.handle === next[index].handle && job.started_at_ms === next[index].started_at_ms
            && job.endedAt === next[index].endedAt && job.failed === next[index].failed,
        ) ? previous : next);
      } catch {
        // A failed snapshot does not tell us which jobs exited.
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

export function useFlowBackground(open: boolean) {
  const watches = useWatchStore((state) => open ? state.watches : null);
  const running = useWatchStore((state) => open ? state.running : null);
  const jobs = useFlowShellJobs(open);
  return useMemo(() => backgroundBranch(watches ?? [], running ?? [], jobs), [watches, running, jobs]);
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
  for (const { handle, started_at_ms, endedAt, failed } of jobs) {
    tasks.push({ id: `job:${handle}:${started_at_ms}`, label: `Process ${handle}`, at: started_at_ms,
      returnedAt: endedAt, failed,
      process: { kind: "background", state: endedAt === undefined ? "running" : undefined } });
  }
  if (!tasks.length) return undefined;
  const start = Math.min(...tasks.map((task) => task.at));
  const run: FlowRun = {
    key: BACKGROUND_GROUP, group: BACKGROUND_GROUP, tabTitle: "Terax tasks", name: "Background activity",
    agent: "terax", harness: "generic", marker: "background", startedAt: start, events: [],
  };
  return { run, tasks, start, events: [], digest: undefined, trace: undefined };
}
