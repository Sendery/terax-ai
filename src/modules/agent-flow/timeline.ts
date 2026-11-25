import { taskStartKind, type FlowKind } from "@/modules/agent-flow/model";
import type { ResolvedDelivery } from "@/modules/agent-flow/coordination";
import { actorEvents, type FlowBranch } from "@/modules/agent-flow/scene";
import { traceKey, type FlowTrace } from "@/modules/agent-flow/traceReader";
import type { TabColor } from "@/modules/tabs/lib/tabColors";

export type TimeMark = { at: number; kind: FlowKind };
export type TimeLane = {
  key: string;
  title: string;
  description?: string;
  color?: TabColor;
  active: boolean;
  marks: TimeMark[];
};

export function buildTimeline(
  branches: readonly FlowBranch[], traces: ReadonlyMap<string, FlowTrace>, deliveries: readonly ResolvedDelivery[] = [],
) {
  const lanes = new Map<string, Omit<TimeLane, "marks"> & { events: Map<number, TimeMark> }>();
  const aggregate = new Map<number, TimeMark>();

  for (const branch of branches) {
    const { run, tasks, events, start, trace } = branch;
    if (run.marker === "terax") continue;
    const shell = run.shellKey ?? (run.leafId === undefined ? run.key : `${run.group}:${run.leafId}`);
    let lane = lanes.get(shell);
    if (!lane) {
      lane = {
        key: shell, title: run.paneLabel ? `${run.tabTitle} · ${run.paneLabel}` : run.tabTitle, description: trace?.name ?? run.name,
        color: run.color, active: !!run.active || tasks.some((task) => task.process?.state === "running"), events: new Map(),
      };
      lanes.set(shell, lane);
    } else if (run.active) {
      lane.active = true;
    }
    const row = lane.events;
    const add = ({ at, kind }: TimeMark) => {
      if (at <= 0 || kind === "usage" || kind === "task-alias") return;
      const mark = { at, kind };
      row.set(at, mark);
      aggregate.set(at, mark);
    };
    if (run.marker !== "background") add({ at: start, kind: "started" });
    for (const event of events) add(event);
    for (const task of tasks) {
      add({ at: task.at, kind: taskStartKind(task) });
      const activity = task.process?.lastActivityAt;
      if (activity !== undefined && activity > task.at) add({ at: activity, kind: "task-activity" });
      if (task.returnedAt !== undefined) add({ at: task.returnedAt, kind: task.failed ? "error" : "returned" });
      const childTrace = traces.get(traceKey(task.run) ?? "");
      if (childTrace) for (const event of actorEvents(branch, task, childTrace)) add(event);
    }
  }
  for (const { at, source, target } of deliveries) {
    const to = lanes.get(target.shellKey);
    const from = source && lanes.get(source.shellKey);
    if (!to && !from) continue;
    const mark = { at, kind: "delivery" } as const;
    to?.events.set(at, mark);
    from?.events.set(at, mark);
    aggregate.set(at, mark);
  }
  const sorted = (events: Map<number, TimeMark>) => [...events.values()].sort((a, b) => a.at - b.at);
  return {
    marks: sorted(aggregate),
    lanes: [...lanes.values()].map(({ events, ...lane }): TimeLane => ({ ...lane, marks: sorted(events) })),
  };
}

export function timeFraction(at: number, start: number, end: number) {
  return end > start ? Math.min(1, Math.max(0, (at - start) / (end - start))) : 0;
}

export function nearTick(marks: readonly TimeMark[], at: number): TimeMark | undefined {
  let lo = 0;
  let hi = marks.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (marks[mid].at < at) lo = mid + 1;
    else hi = mid;
  }
  const earlier = marks[lo - 1];
  const later = marks[lo];
  if (!earlier || !later) return earlier ?? later;
  return at - earlier.at <= later.at - at ? earlier : later;
}
