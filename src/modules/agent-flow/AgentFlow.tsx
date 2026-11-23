import { useMemo, useState } from "react";
import {
  ArrowDown01Icon, ArrowLeft01Icon, Cancel01Icon, Flowchart01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { FlowCanvas, accent, runName } from "@/modules/agent-flow/FlowCanvas";
import { FlowInspector, UsageMetrics } from "@/modules/agent-flow/FlowInspector";
import { FlowTimeline, type TimeMark } from "@/modules/agent-flow/FlowTimeline";
import { beforeTime, sessionFamily, type FlowDirection } from "@/modules/agent-flow/model";
import { branchFor, describeActor, makeScene, type FlowSelection } from "@/modules/agent-flow/scene";
import { traceKey, traceTarget, useFlowTraces, type TraceTarget } from "@/modules/agent-flow/traceReader";
import { useFlowData } from "@/modules/agent-flow/useFlowData";
import "./agent-flow.css";

const HISTORY_READ_AHEAD = 28;

export default function AgentFlow({
  tabs, open, onActivate,
}: {
  tabs: readonly Tab[];
  open: boolean;
  onActivate: (tabId: number, leafId: number) => void;
}) {
  const [direction, setDirection] = useState<FlowDirection>("down");
  const [group, setGroup] = useState("");
  const [scope, setScope] = useState<"active" | "all" | null>(null);
  const [time, setTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<FlowSelection | null>(null);
  const [near, setNear] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [navigator, setNavigator] = useState(false);
  const [search, setSearch] = useState("");
  const [usage, setUsage] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ key: string; tick: number } | null>(null);
  const { runs, children, digests, loading, failed } = useFlowData(tabs, open, refresh);
  const active = runs.filter((run) => run.active).length;
  const actualScope = scope ?? (active ? "active" : "all");

  const groups = useMemo(() => {
    const choices = new Map<string, string>();
    for (const run of runs) choices.set(run.group, run.projectHistory ? `Project: ${run.tabTitle}` : run.tabTitle);
    return [...choices].sort((a, b) => a[1].localeCompare(b[1]));
  }, [runs]);
  const groupKey = groups.some(([key]) => key === group) ? group : "";
  const inScope = useMemo(() => runs.filter((run) =>
    (!groupKey || run.group === groupKey) && (actualScope === "all" || run.active),
  ).sort((a, b) => Number(!!b.active) - Number(!!a.active) || b.startedAt - a.startedAt), [runs, groupKey, actualScope]);
  const selectionRun = selection?.run;
  const selectionTask = selection?.task;
  const live = time === null;

  const targets = useMemo(() => {
    if (!open) return [];
    const nearby = new Set(near);
    const queue = new Map<string, TraceTarget>();
    const add = (target: TraceTarget | undefined) => {
      if (target && (!queue.has(target.key) || target.follow)) queue.set(target.key, target);
    };
    const selected = inScope.find((run) => run.key === selectionRun);
    if (selected) add(traceTarget(selected, live && !!selected.active));
    let history = 0;
    for (const run of inScope) {
      const visible = nearby.has(run.key) || !near.length;
      if (!run.active && !visible && run !== selected) continue;
      if (!run.active && run !== selected && history >= HISTORY_READ_AHEAD) continue;
      if (!run.active) history++;
      const follow = live && !!run.active;
      add(traceTarget(run, follow));
      if (visible || run === selected) {
        for (const descendant of sessionFamily(run, children)) {
          if (descendant.run && (follow || descendant.id === selectionTask)) {
            add(traceTarget(descendant.run, follow));
          }
        }
      }
    }
    return [...queue.values()];
  }, [open, near, inScope, live, selectionRun, selectionTask, children]);
  const traces = useFlowTraces(targets, open, refresh);

  const branches = useMemo(() => inScope.map((run) => branchFor(run, children, digests, traces)), [inScope, children, digests, traces]);
  const scene = useMemo(() => makeScene(branches, direction), [branches, direction]);
  const branch = branches.find((item) => item.run.key === selection?.run);
  const task = branch?.tasks.find((entry) => entry.id === selection?.task && (time === null || entry.at <= time));
  const detailTrace = task ? traces.get(traceKey(task.run) ?? "") : branch?.trace;
  const searchable = search.trim().toLowerCase();
  const matches = navigator ? branches.filter((item) => !searchable ||
    `${item.run.tabTitle} ${runName(item.run, item.trace?.name)} ${displayAgent(item.run.agent)}`.toLowerCase().includes(searchable),
  ) : [];
  const marks = useMemo(() => {
    const at = new Map<number, TimeMark>();
    const add = (mark: TimeMark) => {
      if (mark.at > 0 && mark.kind !== "usage") at.set(mark.at, { at: mark.at, kind: mark.kind });
    };
    for (const item of branches) {
      add({ at: item.start, kind: "started" });
      for (const event of item.events) add(event);
      for (const entry of item.tasks) {
        add({ at: entry.at, kind: "delegated" });
        if (entry.returnedAt !== undefined) add({ at: entry.returnedAt, kind: entry.failed ? "error" : "returned" });
        if (entry.run) {
          for (const event of traces.get(traceKey(entry.run) ?? "")?.events ?? []) add(event);
        }
      }
    }
    return [...at.values()].sort((a, b) => a.at - b.at);
  }, [branches, traces]);
  const measurements = useMemo(() => usage ? branches.flatMap((item) => {
    const entries = [
      { id: item.run.key, name: runName(item.run, item.trace?.name), value: describeActor(item, undefined, item.trace, time).usage },
      ...item.tasks.flatMap((subagent) => {
        const trace = traces.get(traceKey(subagent.run) ?? "");
        return trace ? [{ id: `${item.run.key}:${subagent.id}`, name: subagent.label, value: describeActor(item, subagent, trace, time).usage }] : [];
      }),
    ];
    return entries.flatMap((entry) => entry.value ? [{ ...entry, value: entry.value }] : []);
  }) : [], [branches, time, traces, usage]);
  const aggregate = measurements.reduce<{ tokens: number; cost: number | undefined }>((total, item) => ({
    tokens: total.tokens + item.value.tokens,
    cost: item.value.cost === undefined ? total.cost : (total.cost ?? 0) + item.value.cost,
  }), { tokens: 0, cost: undefined });

  if (!open) return null;

  const visibleBranches = time === null ? branches : branches.filter((item) => item.start <= time);
  const totalAgents = visibleBranches.reduce((sum, item) => sum + 1 + beforeTime(item.tasks, time).length, 0);

  function select(next: FlowSelection) {
    setSelection(next);
    setUsage(false);
  }

  function selectFromList(key: string) {
    select({ run: key });
    setFocusRequest((previous) => ({ key, tick: (previous?.tick ?? 0) + 1 }));
    setNavigator(false);
  }

  function jump(at: number) {
    setPlaying(false);
    setTime(at);
  }

  function changeScope(next: "active" | "all") {
    setScope(next);
    setSelection(null);
    setPlaying(false);
    setTime(null);
  }

  return (
    <section className="agent-flow" aria-label="Agent Flow">
      <header className="flow-topbar">
        <div className="flow-heading">
          <span className="flow-brand"><HugeiconsIcon icon={Flowchart01Icon} size={18} /></span>
          <div><h1>Agent Flow</h1><p>{totalAgents} {totalAgents === 1 ? "agent" : "agents"} · {visibleBranches.length} {visibleBranches.length === 1 ? "session" : "sessions"}</p></div>
        </div>
        <div className="flow-controls">
          <select aria-label="Filter source tab" value={groupKey} onChange={(event) => {
            setGroup(event.target.value);
            setSelection(null);
            setPlaying(false);
            setTime(null);
          }}>
            <option value="">All tabs</option>
            {groups.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select aria-label="Session scope" value={actualScope} onChange={(event) => changeScope(event.target.value === "active" ? "active" : "all")}>
            <option value="active">Active sessions</option>
            <option value="all">All sessions</option>
          </select>
          <button type="button" className="flow-direction" title="Change graph direction"
            aria-label={direction === "down" ? "Switch to right-to-left layout" : "Switch to top-to-bottom layout"}
            onClick={() => setDirection((current) => current === "down" ? "left" : "down")}>
            <HugeiconsIcon icon={direction === "down" ? ArrowDown01Icon : ArrowLeft01Icon} size={15} />
            <span>{direction === "down" ? "Top to bottom" : "Right to left"}</span>
          </button>
          <button type="button" aria-pressed={usage} onClick={() => { setUsage((current) => !current); setSelection(null); }}>Usage</button>
          <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>
      </header>

      <div className="flow-stage">
        <FlowCanvas scene={scene} traces={traces} direction={direction} time={time} target={selection}
          focusRequest={focusRequest} fitRequest={`${direction}:${groupKey}:${actualScope}`}
          loading={loading} onSelect={select} onVisible={setNear} />

        <div className="flow-navigation">
          <button type="button" className="flow-nav-toggle" aria-expanded={navigator}
            onClick={() => setNavigator((current) => !current)}>
            <HugeiconsIcon icon={TerminalIcon} size={15} /> Agents <span>{branches.length}</span>
          </button>
          {navigator ? (
            <div className="flow-nav-panel" role="dialog" aria-label="Find an agent"
              onKeyDown={(event) => { if (event.key === "Escape") setNavigator(false); }}>
              <input type="search" aria-label="Find an agent session" placeholder="Find a session…" value={search}
                onChange={(event) => setSearch(event.target.value)} />
              <ul>
                {matches.map((item) => <li key={item.run.key}>
                  <button type="button" style={accent(item.run)} onClick={() => selectFromList(item.run.key)}>
                    <AgentIcon agent={item.run.agent} harness={item.run.harness} size={16} />
                    <span><b>{runName(item.run, item.trace?.name)}</b><small>{item.run.tabTitle}</small></span>
                    <i className="flow-tab-dot" />
                  </button>
                </li>)}
              </ul>
              {!matches.length ? <p>No matching sessions.</p> : null}
            </div>
          ) : null}
          {failed ? <small className="flow-history-error" role="status">Some history could not load.</small> : null}
        </div>

        {branch && !usage ? (
          <FlowInspector key={`${branch.run.key}:${task?.id ?? "root"}`}
            branch={branch} task={task} trace={detailTrace} eventId={selection?.event} time={time}
            onClose={() => setSelection(null)} onJump={jump} onActivate={onActivate}
            onRoot={() => select({ run: branch.run.key })} />
        ) : null}
        {usage ? (
          <aside className="flow-inspector flow-usage-panel" aria-label="Reported usage">
            <header className="flow-inspector-header">
              <strong>Reported usage</strong>
              <button type="button" className="flow-icon-button" aria-label="Close usage" onClick={() => setUsage(false)}>
                <HugeiconsIcon icon={Cancel01Icon} size={17} />
              </button>
            </header>
            <div className="flow-inspector-scroll">
              {measurements.length ? <>
                <UsageMetrics usage={aggregate} />
                <ul className="flow-usage-list">
                  {measurements.map(({ id, name, value }) => <li key={id}><span>{name}</span><b>{value.tokens.toLocaleString()}</b></li>)}
                </ul>
              </> : <p className="flow-inspector-note">No token or cost records are available in this view.</p>}
              {measurements.length ? <p className="flow-inspector-note">Totals cover usage reported in the loaded transcripts.</p> : null}
            </div>
          </aside>
        ) : null}
      </div>

      <FlowTimeline marks={marks} time={time} setTime={setTime} playing={playing} setPlaying={setPlaying} />
    </section>
  );
}
