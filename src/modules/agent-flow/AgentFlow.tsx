import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon,
  Flowchart01Icon, PlayIcon, PauseIcon, TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import { TAB_COLOR_CSS } from "@/modules/tabs/lib/tabColors";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import {
  beforeTime, CARD_HEIGHT, CARD_WIDTH, FLOW_LABELS, flowTasks,
  isTraceProvider, placeLane, sessionFamily, type FlowDirection, type FlowRun,
  type FlowTask, type TraceEvent,
} from "@/modules/agent-flow/model";
import { useFlowData, useFlowTrace } from "@/modules/agent-flow/useFlowData";
import "./agent-flow.css";

const PAGE_SIZE = 18;
const TASKS_PER_PAGE = 8;
const ACTIVITY_PER_PAGE = 24;
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const timeOnly = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

function runName(run: FlowRun, resolvedName?: string | null) {
  return resolvedName || run.name || (run.sessionId ? `Session ${run.sessionId.slice(0, 8)}` : displayAgent(run.agent));
}

function runState(run: FlowRun, at: number | null) {
  const events = beforeTime(run.events, at);
  for (let index = events.length - 1; index >= 0; index--) {
    const kind = events[index].kind;
    if (kind === "error") return { label: "Error", tone: "error" };
    if (kind === "exited") return { label: "Exited", tone: "rest" };
    if (kind === "attention") return { label: "Needs input", tone: "attention" };
    if (kind === "finished") return { label: "Turn complete", tone: "done" };
    if (kind === "started" || kind === "working") {
      return run.active || at !== null
        ? { label: "Working", tone: "live" }
        : { label: "Last seen working", tone: "rest" };
    }
  }
  return { label: run.projectHistory ? "Project history" : "Recorded", tone: "rest" };
}

type Point = { x: number; y: number };

function pathBetween(root: Point, child: Point, direction: FlowDirection) {
  if (direction === "down") {
    const x1 = root.x + CARD_WIDTH / 2;
    const x2 = child.x + CARD_WIDTH / 2;
    const y1 = root.y + CARD_HEIGHT;
    const y2 = child.y;
    const middle = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`;
  }
  const x1 = root.x;
  const x2 = child.x + CARD_WIDTH;
  const y1 = root.y + CARD_HEIGHT / 2;
  const y2 = child.y + CARD_HEIGHT / 2;
  const middle = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
}

function accent(run: FlowRun): CSSProperties {
  return { "--flow-accent": run.color ? TAB_COLOR_CSS[run.color] : "var(--muted-foreground)" } as CSSProperties;
}

function FlowLane({
  run, time, direction, selected, tasks, task, name, bubble, zoom, onSelect,
}: {
  run: FlowRun;
  time: number | null;
  direction: FlowDirection;
  selected: boolean;
  tasks: FlowTask[];
  task: string | null;
  name?: string | null;
  bubble?: string | null;
  zoom: number;
  onSelect: (task: string | null) => void;
}) {
  const lane = placeLane(tasks, direction);
  const status = runState(run, time);
  const title = runName(run, name);
  const provider = displayAgent(run.agent);
  const events = beforeTime(run.events, time);
  const last = events[events.length - 1];
  const rootStyle = { left: lane.root.x, top: lane.root.y, width: CARD_WIDTH, height: CARD_HEIGHT };
  return (
    <section className="flow-lane" style={accent(run)} aria-label={`${run.tabTitle}, ${title}`}>
      <div className="flow-lane-heading">
        <span className="flow-tab-dot" />
        <span className="flow-lane-name" title={run.tabTitle}>{run.tabTitle}</span>
        <span>{run.projectHistory ? "Project" : "Terminal"}</span>
      </div>
      <div style={{ width: lane.width * zoom, height: lane.height * zoom }}>
        <div className="flow-lane-world" style={{
          width: lane.width, height: lane.height, transform: `scale(${zoom})`,
        }}>
          {tasks.length ? (
            <svg className="flow-edges" width={lane.width} height={lane.height} aria-hidden="true">
              {tasks.map((entry) => {
                const parent = entry.parentId ? lane.positions.get(entry.parentId) : lane.root;
                const child = lane.positions.get(entry.id);
                return parent && child ? (
                  <path key={entry.id} d={pathBetween(parent, child, direction)} data-selected={task === entry.id} />
                ) : null;
              })}
            </svg>
          ) : null}
          <button
            type="button"
            className="flow-node"
            style={rootStyle}
            data-selected={selected && !task}
            aria-pressed={selected && !task}
            onClick={() => onSelect(null)}
          >
            <span className="flow-node-header">
              <span className="flow-provider"><AgentIcon agent={run.agent} harness={run.harness} size={16} /></span>
              <span className="flow-node-identity">
                <strong title={title}>{title}</strong>
                {title !== provider ? <small>{provider}</small> : null}
              </span>
              <span className="flow-status-dot" data-tone={status.tone} />
            </span>
            <span className="flow-bubble">{bubble || last?.text || status.label}</span>
            <span className="flow-node-footer">
              {bubble || last?.text ? status.label : last ? timeOnly.format(last.at) : run.projectHistory ? dateTime.format(run.startedAt) : null}
            </span>
          </button>
          {tasks.map((entry) => (
            <button type="button" key={entry.id} className="flow-node flow-child"
              style={{ left: lane.positions.get(entry.id)?.x, top: lane.positions.get(entry.id)?.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
              data-selected={task === entry.id} aria-pressed={task === entry.id}
              onClick={() => onSelect(entry.id)}
            >
              <span className="flow-node-header">
                <span className="flow-provider"><HugeiconsIcon icon={Flowchart01Icon} size={15} /></span>
                <span className="flow-node-identity">
                  <strong title={entry.label}>{entry.label}</strong>
                  <small title={`${run.tabTitle} · ${title}`}>{run.tabTitle} · {title}</small>
                </span>
              </span>
              <span className="flow-bubble">{entry.failed ? "Subagent failed" : entry.returnedAt ? "Result returned" : entry.parentId ? "Delegated by subagent" : "Delegated by session"}</span>
              <span className="flow-node-footer">Subagent · {timeOnly.format(entry.at)}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function flowEventPriority(event: TraceEvent) {
  return event.kind === "reply" || event.kind === "user" || event.kind === "attention";
}

export default function AgentFlow({
  tabs, open, onActivate,
}: {
  tabs: readonly Tab[];
  open: boolean;
  onActivate: (tabId: number, leafId: number) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [direction, setDirection] = useState<FlowDirection>("down");
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [time, setTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [page, setPage] = useState(0);
  const [taskPage, setTaskPage] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement | null>(null);
  const toolbar = useRef<HTMLButtonElement | null>(null);
  const { runs, children, digests, loading, failed } = useFlowData(tabs, open, refresh);
  const groups = useMemo(() => {
    const choices = new Map<string, string>();
    for (const run of runs) {
      choices.set(run.group, run.projectHistory ? `Project: ${run.tabTitle}` : run.tabTitle);
    }
    return [...choices].sort((a, b) => a[1].localeCompare(b[1]));
  }, [runs]);
  const groupKey = groups.some(([key]) => key === group) ? group : "";
  const filtered = useMemo(
    () => (groupKey ? runs.filter((run) => run.group === groupKey) : runs),
    [groupKey, runs],
  );
  const run = filtered.find((item) => item.key === selected);
  const trace = useFlowTrace(run, open, time === null && run?.active === true, refresh);
  const activity = useMemo(() => [...(run?.events ?? []), ...trace.events]
    .sort((a, b) => a.at - b.at),
  [run, trace.events]);
  const tasks = useMemo(() => flowTasks(beforeTime(activity, time)), [activity, time]);
  const family = useMemo(() => sessionFamily(run, children), [run, children]);
  const digest = run?.active && run.leafId !== undefined ? digests?.[run.leafId] : undefined;
  const ownsDigest = !!run?.sessionId && digest?.sessionId === run.sessionId;
  const liveTasks: FlowTask[] = family.length ? beforeTime(family, time)
    : time === null && ownsDigest && !tasks.length
    ? (digest?.tasks ?? []).filter((entry) => entry.kind === "subagent")
      .map((entry, index) => ({ id: `current:${index}`, at: entry.startedAt, label: entry.label }))
    : tasks;
  const selectedEntry = liveTasks.find((entry) => entry.id === selectedTask);
  const childTrace = useFlowTrace(selectedEntry?.run, open, time === null && run?.active === true, refresh);
  const timeline = useMemo(() => [...new Set([
    ...filtered.flatMap((item) => item.events.length ? item.events.map((event) => event.at) : [item.startedAt]),
    ...activity.map((event) => event.at),
    ...family.map((entry) => entry.at),
    ...childTrace.events.map((event) => event.at),
  ])].filter((at) => at > 0).sort((a, b) => a - b), [filtered, activity, family, childTrace.events]);
  const nextTime = time === null ? -1 : timeline.findIndex((at) => at > time);
  const cursor = nextTime < 0 ? timeline.length - 1 : Math.max(0, nextTime - 1);
  const ordered = useMemo(() => filtered
    .filter((a) => time === null || a.key === selected || (a.createdAt ?? a.events[0]?.at ?? a.startedAt) <= time)
    .sort((a, b) => Number(!!b.active) - Number(!!a.active) || b.startedAt - a.startedAt),
  [filtered, selected, time]);
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = ordered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const focused = visible.find((item) => item.key === selected);
  const taskPages = Math.max(1, Math.ceil(liveTasks.length / TASKS_PER_PAGE));
  const taskIndex = Math.min(taskPage, taskPages - 1);
  const visibleTasks = liveTasks.slice(taskIndex * TASKS_PER_PAGE, (taskIndex + 1) * TASKS_PER_PAGE);
  const activeCount = filtered.filter((item) => item.active).length;
  const recent = beforeTime(activity, time);
  const detailEvents = recent.filter((entry) => entry.kind !== "returned" || entry.taskId && tasks.some((item) => item.id === entry.taskId));
  const selectedEvents = selectedEntry?.run ? beforeTime(childTrace.events, time)
    : selectedTask ? detailEvents.filter((entry) => entry.taskId === selectedTask || entry.id === selectedTask) : detailEvents;
  const detailTrace = selectedEntry?.run ? childTrace : trace;
  const excerpt = [...recent].reverse().find(flowEventPriority);
  const bubble = excerpt?.text ?? (time === null && ownsDigest ? digest?.pendingQuestion ?? digest?.lastReply ?? digest?.recap : undefined);

  useEffect(() => {
    if (!open || !playing || time === null) return;
    let index = timeline.findIndex((at) => at > time);
    if (index < 0) return;
    const timer = setInterval(() => {
      setTime(timeline[index] ?? null);
      index++;
      if (index >= timeline.length) {
        setPlaying(false);
        clearInterval(timer);
      }
    }, 550);
    return () => clearInterval(timer);
  }, [open, playing, time, timeline]);

  if (!open) return null;

  function selectRun(key: string | null, child: string | null = null) {
    setSelected(key);
    setSelectedTask(child);
    if (key !== selected) {
      setTaskPage(0);
      if (key) viewport.current?.scrollTo(0, 0);
    }
    setActivityPage(1);
  }

  function changePage(next: number) {
    setPage(next);
    viewport.current?.scrollTo(0, 0);
  }

  function jump(at: number | null) {
    setPlaying(false);
    setTime(at);
  }

  function fitView() {
    const bounds = viewport.current;
    if (!bounds) return;
    const graph = placeLane(visibleTasks, direction);
    const width = (bounds.clientWidth - 44) / graph.width;
    const height = (bounds.clientHeight - 58) / graph.height;
    setZoom(Math.max(0.35, Math.min(1, width, height)));
    bounds.scrollTo(0, 0);
  }

  function closeDetail() {
    selectRun(null);
    toolbar.current?.focus();
  }

  function renderLane(item: FlowRun) {
    const isSelected = run?.key === item.key;
    const itemDigest = item.active && item.leafId !== undefined ? digests?.[item.leafId] : undefined;
    const preview = time === null && item.sessionId && itemDigest?.sessionId === item.sessionId
      ? itemDigest.pendingQuestion ?? itemDigest.lastReply ?? itemDigest.recap : null;
    return (
      <FlowLane key={item.key} run={item} time={time} direction={direction} zoom={zoom}
        selected={isSelected}
        name={isSelected ? trace.name : null}
        bubble={isSelected ? bubble : preview}
        tasks={isSelected ? visibleTasks : []}
        task={isSelected ? selectedTask : null}
        onSelect={(child) => selectRun(item.key, child)}
      />
    );
  }

  return (
    <section className="agent-flow" aria-label="Agent Flow">
      <header className="flow-header">
        <div className="flow-heading">
          <span className="flow-brand"><HugeiconsIcon icon={Flowchart01Icon} size={19} /></span>
          <div>
            <h1>Agent Flow</h1>
            <span>{filtered.length} {filtered.length === 1 ? "session" : "sessions"} · {activeCount} active</span>
          </div>
        </div>
        <div className="flow-controls">
          <select aria-label="Filter source tab" value={groupKey} onChange={(event) => {
            setGroup(event.target.value);
            selectRun(null);
            changePage(0);
          }}>
            <option value="">All tabs and project history</option>
            {groups.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="button" ref={toolbar}
            aria-label={direction === "down" ? "Switch to right-to-left layout" : "Switch to top-to-bottom layout"}
            onClick={() => setDirection((old) => old === "down" ? "left" : "down")}
          >
            <HugeiconsIcon icon={direction === "down" ? ArrowDown01Icon : ArrowLeft01Icon} size={15} />
            {direction === "down" ? "Top to bottom" : "Right to left"}
          </button>
          <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>Refresh</button>
          <button type="button" className="flow-live" aria-pressed={time === null} onClick={() => jump(null)}>
            <span className="flow-status-dot" data-tone={time === null ? "live" : "rest"} />
            Live
          </button>
        </div>
      </header>

      <div className="flow-workspace">
        <div className="flow-canvas">
          <div className="flow-canvas-bar">
            <span>{time === null ? "Session map" : `Replay · ${timeline.length ? dateTime.format(time) : ""}`}</span>
            <div className="flow-controls">
              <button type="button" aria-label="Zoom out" disabled={zoom <= 0.35} onClick={() => setZoom((value) => Math.max(0.35, value - 0.15))}>−</button>
              <span className="flow-zoom">{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="Zoom in" disabled={zoom >= 1.6} onClick={() => setZoom((value) => Math.min(1.6, value + 0.15))}>+</button>
              <button type="button" onClick={fitView}>Fit view</button>
            </div>
          </div>
          <section className="flow-viewport" ref={viewport} aria-label="Scrollable session map">
            {visible.length ? (
              <>
                {focused ? <div className="flow-focus-lane">{renderLane(focused)}</div> : null}
                <div className="flow-lanes">
                  {visible.filter((item) => item !== focused).map(renderLane)}
                </div>
              </>
            ) : (
              <div className="flow-empty" role="status">
                <HugeiconsIcon icon={Flowchart01Icon} size={32} />
                <strong>{loading ? "Loading session history" : "No sessions in view"}</strong>
                <span>{time === null ? "Start a supported agent in a terminal or choose another source." : "Move the timeline forward or return to Live."}</span>
              </div>
            )}
          </section>
          {pages > 1 || failed ? (
            <div className="flow-pagination">
              <span>{failed ? "Some project history could not be loaded." : `Sessions ${current * PAGE_SIZE + 1}–${Math.min(ordered.length, (current + 1) * PAGE_SIZE)} of ${ordered.length}`}</span>
              {pages > 1 ? <div className="flow-controls">
                <button type="button" disabled={!current} onClick={() => changePage(current - 1)}>Previous</button>
                <button type="button" disabled={current + 1 >= pages} onClick={() => changePage(current + 1)}>Next</button>
              </div> : null}
            </div>
          ) : null}
        </div>

        {run ? (
          <aside className="flow-inspector" aria-label="Session details" style={accent(run)}
            onKeyDown={(event) => { if (event.key === "Escape") closeDetail(); }}>
            <header>
              <span className="flow-inspector-source"><span className="flow-tab-dot" />{run.tabTitle}</span>
              <button type="button" aria-label="Close session details" onClick={closeDetail}>
                <HugeiconsIcon icon={Cancel01Icon} size={16} />
              </button>
            </header>
            <div className="flow-inspector-intro">
              <h2>{selectedEntry?.label ?? runName(run, trace.name)}</h2>
              <p>{displayAgent(run.agent)} · {selectedTask ? "Subagent" : runState(run, time).label}</p>
              {selectedTask ? <button type="button" onClick={() => selectRun(run.key)}>Back to session</button> : null}
              {run.tabId !== undefined && run.leafId !== undefined && run.active ? (
                <button type="button" onClick={() => {
                  if (run.tabId !== undefined && run.leafId !== undefined) onActivate(run.tabId, run.leafId);
                }}>
                  <HugeiconsIcon icon={TerminalIcon} size={14} /> Focus terminal
                </button>
              ) : null}
            </div>
            {taskPages > 1 ? <div className="flow-delegations">
              <span>Subagents {taskIndex * TASKS_PER_PAGE + 1}–{Math.min(liveTasks.length, (taskIndex + 1) * TASKS_PER_PAGE)} of {liveTasks.length}</span>
              <div className="flow-controls">
                <button type="button" aria-label="Previous subagents" disabled={!taskIndex} onClick={() => setTaskPage(taskIndex - 1)}><HugeiconsIcon icon={ArrowLeft01Icon} size={14} /></button>
                <button type="button" aria-label="Next subagents" disabled={taskIndex + 1 >= taskPages} onClick={() => setTaskPage(taskIndex + 1)}><HugeiconsIcon icon={ArrowRight01Icon} size={14} /></button>
              </div>
            </div> : null}
            <div className="flow-activity">
              <h3>Activity</h3>
              {detailTrace.loading ? <p>Loading transcript…</p> : null}
              {detailTrace.failed ? <p role="status">Transcript unavailable. Recorded terminal events are shown.</p> : null}
              {detailTrace.limited ? <p>Recent transcript activity is shown.</p> : null}
              {run.projectHistory ? <p>Matched by project folder.</p> : null}
              {(!isTraceProvider(run.harness) || !run.sessionId) && !trace.loading
                ? <p>Terminal events are available for this session.</p> : null}
              {selectedEvents.length ? (
                <ol>
                  {selectedEvents.slice(-activityPage * ACTIVITY_PER_PAGE).reverse().map((event) => (
                    <li key={event.id}>
                      <button type="button" onClick={() => jump(event.at)}>
                        <span><strong>{FLOW_LABELS[event.kind]}</strong><time dateTime={new Date(event.at).toISOString()}>{timeOnly.format(event.at)}</time></span>
                        {event.text ? <small>{event.text}</small> : null}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : !detailTrace.loading ? <p>No events at this point in time.</p> : null}
              {selectedEvents.length > activityPage * ACTIVITY_PER_PAGE ? (
                <button type="button" onClick={() => setActivityPage((value) => value + 1)}>Earlier events</button>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      <footer className="flow-timeline">
        <button type="button" aria-label={playing ? "Pause replay" : "Play timeline"} disabled={timeline.length < 2}
          onClick={() => {
            if (playing) { setPlaying(false); return; }
            if (time === null || cursor >= timeline.length - 1) setTime(timeline[0]);
            setPlaying(true);
          }}>
          <HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={17} />
        </button>
        <div className="flow-scrubber">
          <div><label htmlFor="agent-flow-time">Timeline</label><span>{time === null ? "Live edge" : timeline.length ? dateTime.format(timeline[cursor]) : ""}</span></div>
          <input id="agent-flow-time" type="range" min={0} max={Math.max(1, timeline.length - 1)}
            disabled={timeline.length < 2} value={Math.max(0, cursor)}
            style={{
              "--flow-progress": `${timeline.length > 1 ? Math.max(0, cursor) / (timeline.length - 1) * 100 : 0}%`,
            } as CSSProperties}
            aria-valuetext={timeline[cursor] ? dateTime.format(timeline[cursor]) : "No recorded events"}
            onChange={(event) => jump(timeline[Number(event.target.value)] ?? null)} />
        </div>
        <button type="button" onClick={() => jump(null)} disabled={time === null}>Go live</button>
      </footer>
    </section>
  );
}
