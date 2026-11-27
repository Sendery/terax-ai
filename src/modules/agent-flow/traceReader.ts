import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
  isTraceProvider,
  type FlowRun,
  type Trace,
  type TraceEvent,
  type TraceProvider,
} from "@/modules/agent-flow/model";

const CONCURRENCY = 4;
const FOLLOW_MS = 2200;
const RETRY_MS = 8000;
const RECENT_CACHE = 120;
const MAX_EVENTS = 600;

export type TraceTarget = { key: string; provider: TraceProvider; id: string; follow: boolean };
export type FlowTrace = {
  events: readonly TraceEvent[];
  name: string | null;
  limited: boolean;
  failed: boolean;
};
type Entry = { offset: number; due: number; followed: boolean; snapshot: FlowTrace | undefined };

export const EMPTY_TRACE: FlowTrace = { events: [], name: null, limited: false, failed: false };

export function traceKey(run: FlowRun | undefined): string | undefined {
  return run?.sessionId && isTraceProvider(run.harness) ? `${run.harness}:${run.sessionId}` : undefined;
}

export function traceTarget(run: FlowRun, follow: boolean): TraceTarget | undefined {
  if (!run.sessionId || !isTraceProvider(run.harness)) return undefined;
  return { key: `${run.harness}:${run.sessionId}`, provider: run.harness, id: run.sessionId, follow };
}

export function mergeTrace(previous: FlowTrace | undefined, incoming: Trace): FlowTrace {
  const old = incoming.reset ? undefined : previous;
  if (old && !old.failed && !incoming.events.length && !incoming.name && !incoming.limited) return old;
  const byId = new Map((old?.events ?? []).map((event) => [event.id, event]));
  for (const event of incoming.events) {
    const previous = byId.get(event.id);
    if (!previous) byId.set(event.id, event);
    else if (!previous.file && event.file) byId.set(event.id, { ...previous, file: event.file });
  }
  const events = [...byId.values()];
  return {
    events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events,
    name: incoming.name ?? old?.name ?? null,
    failed: false,
    limited: !!old?.limited || incoming.limited || events.length > MAX_EVENTS,
  };
}

export function useFlowTraces(targets: readonly TraceTarget[], open: boolean, refresh: number) {
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, FlowTrace>>(new Map());
  const cache = useRef(new Map<string, Entry>());
  const plan = useRef(targets);
  const wake = useRef<(() => void) | null>(null);
  const lastRefresh = useRef(0);

  useEffect(() => {
    plan.current = targets;
    wake.current?.();
  }, [targets]);

  useEffect(() => {
    if (!open) return;
    const entries = cache.current;
    let stopped = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const publish = () => {
      const next = new Map<string, FlowTrace>();
      for (const [key, entry] of entries) {
        if (entry.snapshot) next.set(key, entry.snapshot);
      }
      setSnapshots(next);
    };

    if (refresh !== lastRefresh.current) {
      lastRefresh.current = refresh;
      entries.clear();
    }

    const schedule = (delay = 0) => {
      if (stopped || busy || document.visibilityState === "hidden") return;
      clearTimeout(timer);
      timer = setTimeout(() => void pull(), delay);
    };

    const pull = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      const queue = plan.current;
      const requested = new Set(queue.map((target) => target.key));
      let changed = false;
      for (const key of entries.keys()) {
        if (entries.size <= Math.max(RECENT_CACHE, requested.size)) break;
        if (!requested.has(key)) {
          entries.delete(key);
          changed = true;
        }
      }

      const now = Date.now();
      const pending = queue
        .filter(({ key, follow }) => follow || entries.get(key)?.followed || !entries.get(key)?.snapshot)
        .map((target, index) => ({ target, index, due: entries.get(target.key)?.due ?? 0 }))
        .sort((a, b) => a.due - b.due || a.index - b.index);
      const due = pending.filter((entry) => entry.due <= now).slice(0, CONCURRENCY);
      if (!due.length) {
        if (changed) publish();
        if (pending.length) schedule(pending[0].due - now);
        return;
      }

      busy = true;
      await Promise.all(due.map(async ({ target }) => {
        const current = entries.get(target.key);
        try {
          const incoming = await invoke<Trace>("agent_flow_trace", {
            provider: target.provider, id: target.id, offset: current?.offset ?? 0,
          });
          if (stopped) return;
          const snapshot = mergeTrace(current?.snapshot, incoming);
          entries.set(target.key, { offset: incoming.nextOffset, due: Date.now() + FOLLOW_MS, followed: target.follow, snapshot });
          changed ||= snapshot !== current?.snapshot;
        } catch {
          if (stopped) return;
          const snapshot = current?.snapshot?.failed ? current.snapshot : { ...current?.snapshot ?? EMPTY_TRACE, failed: true };
          entries.set(target.key, { offset: current?.offset ?? 0, due: Date.now() + RETRY_MS, followed: target.follow, snapshot });
          changed ||= snapshot !== current?.snapshot;
        }
      }));
      busy = false;
      if (stopped) return;
      if (changed) publish();
      schedule();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") clearTimeout(timer);
      else schedule();
    };
    wake.current = schedule;
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      stopped = true;
      wake.current = null;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [open, refresh]);

  return snapshots;
}
