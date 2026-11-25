import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, Flowchart01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { collectNodeStatus, fileCrossings, fileRelations, relayGraph, resolveDeliveries, type FileCrossing } from "@/modules/agent-flow/coordination";
import { FlowCanvas, accent, runName } from "@/modules/agent-flow/FlowCanvas";
import { FlowInspector, UsageMetrics } from "@/modules/agent-flow/FlowInspector";
import { FlowRelationDetails } from "@/modules/agent-flow/FlowRelationDetails";
import { currentSourceFilter, FlowSourceFilter, shellGroup, sourceGroups, sourceMatches, type SourceFilter } from "@/modules/agent-flow/FlowSourceFilter";
import { SignalStrip } from "@/modules/agent-flow/FlowSignals";
import { FlowTimeline, flowTime } from "@/modules/agent-flow/FlowTimeline";
import { beforeTime, sessionFamily, type FlowDirection, type FlowRun, type TraceEvent } from "@/modules/agent-flow/model";
import { actorEvents, branchFor, describeActor, eventLabel, liveBranches, signalEvents, signalTone, type FlowArrangement, type FlowSelection } from "@/modules/agent-flow/scene";
import { traceKey, traceTarget, useFlowTraces, type TraceTarget } from "@/modules/agent-flow/traceReader";
import { buildTimeline } from "@/modules/agent-flow/timeline";
import { useFlowData, type FlowData } from "@/modules/agent-flow/useFlowData";
import { useFlowBackground } from "@/modules/agent-flow/background";
import type { FlowBranch } from "@/modules/agent-flow/scene";
import "./agent-flow.css";

const HISTORY_READ_AHEAD = 28;

export default function AgentFlow({
  tabs, open, onActivate,
}: {
  tabs: readonly Tab[];
  open: boolean;
  onActivate: (tabId: number, leafId: number) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const data = useFlowData(tabs, open, refresh);
  const background = useFlowBackground(open);

  function detach() {
    setMessage("");
    void invoke("open_agent_flow_window").catch(() => setMessage("Agent Flow could not open in a separate window."));
  }

  return <AgentFlowView open={open} data={data} background={background} onActivate={onActivate}
    refresh={refresh} onRefresh={() => setRefresh((value) => value + 1)}
    windowAction={isTauri() ? { label: "Detach", run: detach } : undefined} windowMessage={message} />;
}

export function AgentFlowView({
  open, data, background, refresh, onRefresh, onActivate, onOpenDiff, windowAction, windowMessage,
}: {
  open: boolean;
  data: FlowData;
  background?: FlowBranch;
  refresh: number;
  onRefresh: () => void;
  onActivate: (tabId: number, leafId: number) => void;
  onOpenDiff?: (file: FileCrossing) => Promise<string | undefined>;
  windowAction?: { label: string; run: () => void };
  windowMessage?: string;
}) {
  const [direction, setDirection] = useState<FlowDirection>("down");
  const [arrangement, setArrangement] = useState<FlowArrangement>("fit");
  const [groupsFilter, setGroupsFilter] = useState<SourceFilter>(() => new Map());
  const [actualScope, setScope] = useState<"active" | "all">("active");
  const [time, setTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<FlowSelection | null>(null);
  const [near, setNear] = useState<string[]>([]);
  const [navigator, setNavigator] = useState(false);
  const [search, setSearch] = useState("");
  const [usage, setUsage] = useState(false);
  const [relationKey, setRelationKey] = useState<string | null>(null);
  const [pinnedRun, setPinnedRun] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ key: string; tick: number } | null>(null);
  const [retirementTick, setRetirementTick] = useState(0);
  const { runs, children, digests, panes, hidden, deliveries, notifications, loading, failed } = data;
  const scopedRuns = useMemo(() => runs.filter((run) => actualScope === "all" || run.active), [runs, actualScope]);
  const groups = useMemo(() => sourceGroups(panes, background ? [...scopedRuns, background.run] : scopedRuns),
    [panes, scopedRuns, background]);
  const filter = useMemo(() => currentSourceFilter(groupsFilter, groups), [groupsFilter, groups]);
  const groupKey = JSON.stringify([...filter].map(([key, shells]) => [key, shells && [...shells].sort()]).sort());
  const inScope = useMemo(() => scopedRuns.filter((run) => sourceMatches(filter, run.group, run.shellKey))
    .sort((a, b) => Number(!!b.active) - Number(!!a.active) || b.startedAt - a.startedAt), [scopedRuns, filter]);
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
    let historicalChildren = 0;
    for (const run of inScope) {
      const visible = nearby.has(run.key) || !near.length;
      if (!run.active && !visible && run !== selected) continue;
      if (!run.active && run !== selected && history >= HISTORY_READ_AHEAD) continue;
      if (!run.active) history++;
      const follow = live && !!run.active;
      add(traceTarget(run, follow));
      if (visible || run === selected) {
        for (const descendant of sessionFamily(run, children)) {
          if (!descendant.run) continue;
          const inspect = run === selected && descendant.id === selectionTask;
          if (!inspect && !run.active && historicalChildren++ >= HISTORY_READ_AHEAD) continue;
          add(traceTarget(descendant.run, follow));
        }
      }
    }
    return [...queue.values()];
  }, [open, near, inScope, live, selectionRun, selectionTask, children]);
  const traces = useFlowTraces(targets, open, refresh);

  const branches = useMemo(() => inScope.map((run) => branchFor(run, children, digests, traces)), [inScope, children, digests, traces]);
  const visibleDeliveries = useMemo(() => {
    const matches = ({ shellKey }: { shellKey: string }) => sourceMatches(filter, shellGroup(shellKey), shellKey);
    return resolveDeliveries((deliveries ?? []).filter(({ source, target }) => matches(target) && (!source || matches(source))),
      panes, runs, hidden, null);
  }, [deliveries, panes, runs, hidden, filter]);
  const relay = useMemo(() => relayGraph(visibleDeliveries, inScope, new Set()), [visibleDeliveries, inScope]);
  const showBackground = background && sourceMatches(filter, background.run.group) ? background : undefined;
  const graphBranches = useMemo(() => [...branches, ...(showBackground ? [showBackground] : []), ...relay.markers.map((run) => ({
    run, events: run.events, trace: undefined, digest: undefined, tasks: [], start: run.startedAt,
  }))], [branches, showBackground, relay.markers]);
  const { branches: canvasBranches, nextExpiry } = useMemo(() => live && actualScope === "active"
    ? liveBranches(graphBranches, traces, Math.max(Date.now(), retirementTick), selection, actualScope === "active")
    : { branches: graphBranches, nextExpiry: Infinity }, [live, graphBranches, retirementTick, selection, traces, actualScope]);
  useEffect(() => {
    if (!open || !Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setRetirementTick(Date.now()), Math.max(1, nextExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [open, nextExpiry]);
  const relations = useMemo(() => [
    ...relay.links.flatMap((link) => {
      if (time === null) return [link];
      const entries = link.deliveries.filter(({ at }) => at <= time);
      return entries.length ? [{ ...link, deliveries: entries }] : [];
    }),
    ...fileRelations(fileCrossings(branches, traces, time)),
  ], [relay.links, branches, traces, time]);
  const relation = relations.find(({ key }) => key === relationKey);
  const nodeStatus = useMemo(() => collectNodeStatus(panes, runs, notifications ?? []), [panes, runs, notifications]);
  const branch = graphBranches.find((item) => item.run.key === selection?.run);
  const task = branch?.tasks.find((entry) => entry.id === selection?.task && (time === null || entry.at <= time));
  const detailTrace = task ? traces.get(traceKey(task.run) ?? "") : branch?.trace;
  const searchable = search.trim().toLowerCase();
  const matches = navigator ? branches.filter((item) => !searchable ||
    `${item.run.tabTitle} ${runName(item.run, item.trace?.name)} ${displayAgent(item.run.agent)}`.toLowerCase().includes(searchable),
  ) : [];
  const timeline = useMemo(() => buildTimeline(graphBranches, traces, visibleDeliveries), [graphBranches, traces, visibleDeliveries]);
  const signalFeed = useMemo(() => {
    const signals: { key: string; run: FlowRun; agent: string; event: TraceEvent; task?: string }[] = [];
    for (const entry of branches) {
      const add = (events: readonly TraceEvent[], agent: string, task?: string) => {
        for (const event of signalEvents(beforeTime(events, time), 8)) {
          if (event.kind === "returned" && !task && !entry.tasks.some((item) => item.id === event.taskId)) continue;
          const key = `${entry.run.key}:${task ?? "root"}:${event.id}`;
          signals.push({ key, run: entry.run, agent, event, task });
        }
      };
      add(actorEvents(entry, undefined, entry.trace), runName(entry.run, entry.trace?.name));
      for (const item of entry.tasks) {
        const trace = traces.get(traceKey(item.run) ?? "");
        if (trace) add(trace.events, item.label, item.id);
        else add(actorEvents(entry, item, undefined).filter(({ kind }) => kind === "tool"), item.label, item.id);
      }
    }
    return signals.sort((a, b) => a.event.at - b.event.at).slice(-12);
  }, [branches, traces, time]);
  const latest = signalFeed[signalFeed.length - 1];
  const measurements = useMemo(() => usage ? branches.flatMap((item) => {
    const entries = [
      { id: item.run.key, name: runName(item.run, item.trace?.name), color: accent(item.run), value: describeActor(item, undefined, item.trace, time).usage },
      ...item.tasks.flatMap((subagent) => {
        const trace = traces.get(traceKey(subagent.run) ?? "");
        return [{ id: `${item.run.key}:${subagent.id}`, name: subagent.label,
          color: accent(item.run), value: describeActor(item, subagent, trace, time).usage }];
      }),
    ];
    return entries.flatMap((entry) => entry.value ? [{ ...entry, value: entry.value }] : []);
  }) : [], [branches, time, traces, usage]);
  const aggregate = measurements.reduce<{ tokens: number; cost: number | undefined }>((total, item) => ({
    tokens: total.tokens + item.value.tokens,
    cost: item.value.cost === undefined ? total.cost : (total.cost ?? 0) + item.value.cost,
  }), { tokens: 0, cost: undefined });
  const peakUsage = Math.max(1, ...measurements.map((item) => item.value.tokens));

  if (!open) return null;

  const visibleBranches = canvasBranches.filter((item) => !item.run.marker && (time === null || item.start <= time));
  const totalAgents = visibleBranches.length + canvasBranches.reduce((sum, item) => sum + beforeTime(item.tasks, time).filter((task) => !task.process).length, 0);
  const totalTasks = canvasBranches.reduce((sum, item) => sum + beforeTime(item.tasks, time).filter((task) => task.process).length, 0);

  function select(next: FlowSelection) {
    setSelection(next);
    setUsage(false);
    setRelationKey(null);
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

  function inspectRun(run: string, event?: string, at?: number, task?: string) {
    select({ run, task, event });
    setPlaying(false);
    if (at !== undefined) setTime(at);
    setFocusRequest((previous) => ({ key: run, tick: (previous?.tick ?? 0) + 1 }));
  }

  function selectRelation(key: string) {
    setRelationKey(key);
    setSelection(null);
    setUsage(false);
  }

  function changeScope(next: "active" | "all") {
    setScope(next);
    setSelection(null);
    setRelationKey(null);
    setPlaying(false);
    setTime(null);
  }

  function changeGroups(next: SourceFilter) {
    setGroupsFilter(next);
    setSelection(null);
    setRelationKey(null);
  }

  return (
    <section className="agent-flow" aria-label="Agent Flow">
      <header className="flow-topbar">
        <div className="flow-heading">
          <span className="flow-brand"><HugeiconsIcon icon={Flowchart01Icon} size={18} /></span>
          <div><h1>Agent Flow</h1><p>{totalAgents} {totalAgents === 1 ? "agent" : "agents"} · {visibleBranches.length} {visibleBranches.length === 1 ? "session" : "sessions"}{totalTasks ? ` · ${totalTasks} ${totalTasks === 1 ? "task" : "tasks"}` : ""}</p></div>
        </div>
        <div className="flow-controls">
          <FlowSourceFilter groups={groups} filter={filter} onChange={changeGroups} />
          <select aria-label="Session scope" value={actualScope} onChange={(event) => changeScope(event.target.value === "active" ? "active" : "all")}>
            <option value="active">Active sessions</option>
            <option value="all">All sessions</option>
          </select>
          <button type="button" className="flow-direction" title="Change graph direction"
            aria-label={direction === "down" ? "Switch to left-to-right layout" : "Switch to top-to-bottom layout"}
            onClick={() => setDirection((current) => current === "down" ? "right" : "down")}>
            <HugeiconsIcon icon={direction === "down" ? ArrowDown01Icon : ArrowRight01Icon} size={15} />
            <span>{direction === "down" ? "Top to bottom" : "Left to right"}</span>
          </button>
          <button type="button" className="flow-arrangement" aria-label="Session lanes"
            aria-pressed={arrangement === "lanes"} title="Switch between fitting the map and one lane per session"
            onClick={() => setArrangement((current) => current === "fit" ? "lanes" : "fit")}>
            {arrangement === "fit" ? "Fit to screen" : direction === "right" ? "Session rows" : "Session columns"}
          </button>
          <button type="button" aria-pressed={usage} onClick={() => {
            setUsage((current) => !current);
            setSelection(null);
            setRelationKey(null);
          }}>Usage</button>
          <button type="button" onClick={onRefresh} disabled={loading}>Refresh</button>
          {windowAction ? <button type="button" onClick={windowAction.run}>{windowAction.label}</button> : null}
        </div>
      </header>

      {windowMessage ? <p role="status" className="flow-window-message">{windowMessage}</p> : null}
      <div className="flow-stage">
        <FlowCanvas branches={canvasBranches} traces={traces} direction={direction} arrangement={arrangement} time={time} target={selection}
          focusRequest={focusRequest} fitRequest={`${direction}:${arrangement}:${groupKey}:${actualScope}`}
          pinnedRun={pinnedRun} relations={relations} activeRelation={relation} nodeStatus={nodeStatus}
          onRelation={selectRelation}
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

        {latest ? (
          <button type="button" className="flow-activity-hud"
            aria-label={`Inspect latest signal from ${latest.agent}: ${eventLabel(latest.event)}`}
            style={accent(latest.run)} onClick={() => select({ run: latest.run.key, task: latest.task, event: latest.event.id })}>
            <span className="flow-hud-light" data-signal={signalTone(latest.event.kind)} aria-hidden="true" />
            <span className="flow-hud-detail" key={latest.key}>
              <strong>{latest.agent}</strong>
              <small>{eventLabel(latest.event)} {latest.event.file ? `· ${latest.event.file.split(/[\\/]/).pop()}` : ""}</small>
            </span>
            <span className="flow-hud-time">
              <time dateTime={new Date(latest.event.at).toISOString()}>{flowTime.format(latest.event.at)}</time>
              <SignalStrip events={signalFeed.map(({ event, key }) => ({ ...event, id: key }))} />
            </span>
          </button>
        ) : null}

        {relation ? (
          <FlowRelationDetails key={relation.key} relation={relation} close={() => setRelationKey(null)}
            activate={onActivate} inspect={inspectRun} seek={jump} openDiff={onOpenDiff} />
        ) : null}

        {branch && !usage && !relation ? (
          <FlowInspector key={`${branch.run.key}:${task?.id ?? "root"}`}
            branch={branch} task={task} trace={detailTrace} eventId={selection?.event} time={time}
            onClose={() => setSelection(null)} onJump={jump} onActivate={onActivate}
            pending={time === null ? nodeStatus.get(branch.run.key)?.pending : undefined}
            relations={relations.filter(({ from, to }) => from === branch.run.key || to === branch.run.key)}
            onRelation={selectRelation}
            pinned={pinnedRun === branch.run.key} onPin={() => setPinnedRun((current) => current === branch.run.key ? null : branch.run.key)}
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
                  {measurements.map(({ id, name, color, value }) => <li key={id}
                    style={{ ...color, "--flow-usage-fill": `${(value.tokens / peakUsage) * 100}%` } as CSSProperties}>
                    <span>{name}</span><b>{value.tokens.toLocaleString()}</b>
                  </li>)}
                </ul>
              </> : <p className="flow-inspector-note">No token or cost records are available in this view.</p>}
              {measurements.length ? <p className="flow-inspector-note">Totals cover usage reported in the loaded transcripts.</p> : null}
            </div>
          </aside>
        ) : null}
      </div>

      <FlowTimeline marks={timeline.marks} lanes={timeline.lanes} time={time} setTime={setTime}
        playing={playing} setPlaying={setPlaying} />
    </section>
  );
}
