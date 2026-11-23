import { useMemo, useState, type CSSProperties } from "react";
import {
  ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon, Flowchart01Icon,
  SparklesIcon, TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { collectAttention, fileCrossings, resolveDeliveries } from "@/modules/agent-flow/coordination";
import { FlowCanvas, accent, runName } from "@/modules/agent-flow/FlowCanvas";
import { FlowInspector, UsageMetrics } from "@/modules/agent-flow/FlowInspector";
import { FlowOperations, type FlowConnection, type FlowOperation } from "@/modules/agent-flow/FlowOperations";
import { SignalStrip } from "@/modules/agent-flow/FlowSignals";
import { FlowTimeline, flowTime } from "@/modules/agent-flow/FlowTimeline";
import { beforeTime, sessionFamily, type FlowDirection, type FlowRun, type TraceEvent } from "@/modules/agent-flow/model";
import { branchFor, describeActor, eventLabel, makeScene, signalEvents, signalTone, type FlowArrangement, type FlowSelection } from "@/modules/agent-flow/scene";
import { traceKey, traceTarget, useFlowTraces, type TraceTarget } from "@/modules/agent-flow/traceReader";
import { buildTimeline } from "@/modules/agent-flow/timeline";
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
  const [arrangement, setArrangement] = useState<FlowArrangement>("fit");
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
  const [operations, setOperations] = useState<FlowOperation>(null);
  const [connection, setConnection] = useState<FlowConnection>(null);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [pinnedRun, setPinnedRun] = useState<string | null>(null);
  const [motion, setMotion] = useState(true);
  const [focusRequest, setFocusRequest] = useState<{ key: string; tick: number } | null>(null);
  const { runs, children, digests, panes, hidden, deliveries, loading, failed } = useFlowData(tabs, open, refresh);
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
  const scene = useMemo(() => makeScene(branches, direction, arrangement), [branches, direction, arrangement]);
  const branch = branches.find((item) => item.run.key === selection?.run);
  const task = branch?.tasks.find((entry) => entry.id === selection?.task && (time === null || entry.at <= time));
  const detailTrace = task ? traces.get(traceKey(task.run) ?? "") : branch?.trace;
  const searchable = search.trim().toLowerCase();
  const matches = navigator ? branches.filter((item) => !searchable ||
    `${item.run.tabTitle} ${runName(item.run, item.trace?.name)} ${displayAgent(item.run.agent)}`.toLowerCase().includes(searchable),
  ) : [];
  const visibleDeliveries = useMemo(() => resolveDeliveries(deliveries ?? [], panes, runs, hidden, null),
    [deliveries, panes, runs, hidden]);
  const replayDeliveries = useMemo(() => visibleDeliveries.filter((item) => time === null || item.at <= time), [visibleDeliveries, time]);
  const attention = useMemo(() => collectAttention(panes, runs, traces).filter(({ id }) => !dismissed.includes(id)),
    [panes, runs, traces, dismissed]);
  const files = useMemo(() => {
    if (operations !== "connections") return [];
    const observed = runs.filter((run) => traces.has(traceKey(run) ?? ""));
    return fileCrossings(observed.map((run) => branchFor(run, children, digests, traces)), traces, time);
  }, [operations, runs, children, digests, traces, time]);
  const linkedDelivery = connection?.kind === "delivery" ? replayDeliveries.find(({ id }) => id === connection.key) : undefined;
  const linkedFile = connection?.kind === "file" ? files.find(({ path }) => path === connection.key) : undefined;
  const linkedRuns = new Set([
    linkedDelivery?.from?.run?.key, linkedDelivery?.to.run?.key,
    ...linkedFile?.touches.map(({ run }) => run.key) ?? [],
  ].filter((key): key is string => !!key));
  const timeline = useMemo(() => buildTimeline(branches, traces, visibleDeliveries), [branches, traces, visibleDeliveries]);
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
      add(entry.events, runName(entry.run, entry.trace?.name));
      for (const item of entry.tasks) {
        const trace = traces.get(traceKey(item.run) ?? "");
        if (trace) add(trace.events, item.label, item.id);
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
        return trace ? [{ id: `${item.run.key}:${subagent.id}`, name: subagent.label,
          color: accent(item.run), value: describeActor(item, subagent, trace, time).usage }] : [];
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

  const visibleBranches = time === null ? branches : branches.filter((item) => item.start <= time);
  const totalAgents = visibleBranches.reduce((sum, item) => sum + 1 + beforeTime(item.tasks, time).length, 0);

  function select(next: FlowSelection) {
    setSelection(next);
    setUsage(false);
    setOperations(null);
    setConnection(null);
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

  function inspectOperation(run: string, event?: string, at?: number, task?: string) {
    if (!inScope.some(({ key }) => key === run)) {
      setGroup("");
      setScope("all");
    }
    select({ run, task, event });
    setPlaying(false);
    setTime(at ?? null);
    setFocusRequest((previous) => ({ key: run, tick: (previous?.tick ?? 0) + 1 }));
  }

  function toggleOperation(next: NonNullable<FlowOperation>) {
    setOperations((current) => current === next ? null : next);
    setConnection(null);
    setSelection(null);
    setUsage(false);
  }

  function showConnection(next: FlowConnection) {
    setConnection(next);
    const receipt = next?.kind === "delivery" ? replayDeliveries.find(({ id }) => id === next.key) : undefined;
    const file = next?.kind === "file" ? files.find(({ path }) => path === next.key) : undefined;
    const connected = [receipt?.from?.run, receipt?.to.run, ...file?.touches.map(({ run }) => run) ?? []];
    if (connected.some((run) => run && !inScope.some(({ key }) => key === run.key))) {
      setGroup("");
      setScope("all");
    }
  }

  function changeScope(next: "active" | "all") {
    setScope(next);
    setSelection(null);
    setPlaying(false);
    setTime(null);
  }

  return (
    <section className="agent-flow" aria-label="Agent Flow" data-motion={motion}>
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
          <button type="button" className="flow-attention-toggle" data-alert={attention.length > 0}
            aria-expanded={operations === "attention"} onClick={() => toggleOperation("attention")}>
            Attention <strong>{attention.length}</strong>
          </button>
          <button type="button" aria-expanded={operations === "terminals"} onClick={() => toggleOperation("terminals")}>Terminals</button>
          <button type="button" aria-expanded={operations === "connections"} onClick={() => toggleOperation("connections")}>Connections</button>
          <button type="button" aria-pressed={usage} onClick={() => {
            setUsage((current) => !current);
            setSelection(null);
            setOperations(null);
            setConnection(null);
          }}>Usage</button>
          <button type="button" className="flow-motion" aria-label="Motion effects" aria-pressed={motion}
            onClick={() => setMotion((current) => !current)}>
            <HugeiconsIcon icon={SparklesIcon} size={14} /> <span>Motion</span>
          </button>
          <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>
      </header>

      <div className="flow-stage">
        <FlowCanvas scene={scene} traces={traces} direction={direction} arrangement={arrangement} time={time} target={selection}
          focusRequest={focusRequest} fitRequest={`${direction}:${arrangement}:${groupKey}:${actualScope}`}
          pinnedRun={pinnedRun} linkedRuns={linkedRuns}
          linkFrom={linkedDelivery?.from?.run?.key} linkTo={linkedDelivery?.to.run?.key}
          loading={loading} motion={motion} onSelect={select} onVisible={setNear} />

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

        {operations ? (
          <FlowOperations mode={operations} panes={panes} attention={attention} deliveries={replayDeliveries}
            files={files} connection={connection} close={() => { setOperations(null); setConnection(null); }}
            activate={onActivate} inspect={inspectOperation} selectConnection={showConnection}
            openTouch={({ run, event, task }) => inspectOperation(run.key, event.id, event.at, task)}
            dismiss={(id) => setDismissed((current) => [...current.slice(-79), id])} />
        ) : null}

        {branch && !usage && !operations ? (
          <FlowInspector key={`${branch.run.key}:${task?.id ?? "root"}`}
            branch={branch} task={task} trace={detailTrace} eventId={selection?.event} time={time}
            onClose={() => setSelection(null)} onJump={jump} onActivate={onActivate}
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
