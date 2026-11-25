import {
  type CSSProperties, type KeyboardEvent, type PointerEvent,
  memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { ArrowDown01Icon, ArrowUp01Icon, File01Icon, Flowchart01Icon, MapsIcon, Message01Icon, Radar01Icon, RepeatIcon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import { relationDescription, relationLabel, type FlowNodeStatus, type FlowRelation } from "@/modules/agent-flow/coordination";
import { TAB_COLOR_CSS } from "@/modules/tabs/lib/tabColors";
import { BeaconSignals, ToolMark } from "@/modules/agent-flow/FlowSignals";
import { PROCESS_LABELS, type FlowDirection, type FlowRun, type FlowTask, type TraceEvent } from "@/modules/agent-flow/model";
import {
  COMPACT_SCALE, contextPercent, describeActor, edgeGeometry, eventLabel, fitFlowCamera, laneCamera, makeScene, nodeGeometry, overlaps, runOutcome, zoomFlowCamera,
  type Box, type Camera, type FlowArrangement, type FlowBranch, type FlowSelection, type Point,
} from "@/modules/agent-flow/scene";
import { traceKey, type FlowTrace } from "@/modules/agent-flow/traceReader";

const number = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const activityTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const initialCamera = { x: 0, y: 0, scale: 1 };

export function accent(run: FlowRun): CSSProperties {
  return { "--flow-accent": run.color ? TAB_COLOR_CSS[run.color] : "var(--flow-default)" } as CSSProperties;
}

export function runName(run: FlowRun, resolvedName?: string | null): string {
  return resolvedName || run.name || (run.sessionId ? `Session ${run.sessionId.slice(0, 8)}` : displayAgent(run.agent));
}

function recent(event: number | undefined, time: number | null, clock: number) {
  return event !== undefined && (time === null ? Math.abs(clock - event) < 6000 : event === time);
}

function fromCoordinator(relation: FlowRelation) {
  return relation.kind === "relay" && !relation.deliveries[0]?.from;
}

function RelationLine({ from, to, relation, selected, offset, rowPort, onSelect }: {
  from: Box; to: Box; relation: FlowRelation; selected: boolean; offset: number; onSelect: (key: string) => void;
  rowPort: boolean;
}) {
  const coordinator = fromCoordinator(relation);
  const across = rowPort || (!coordinator && (from.x + from.width <= to.x || to.x + to.width <= from.x));
  const sign = (across ? to.x - from.x : to.y - from.y) < 0 ? -1 : 1;
  const start = across
    ? { x: from.x + (sign > 0 ? from.width : 0), y: from.y + from.height / 2 }
    : { x: from.x + from.width / 2, y: from.y + (sign > 0 ? from.height : 0) };
  const end = rowPort
    ? { x: to.x, y: to.y + Math.min(54, to.height / 2) }
    : across
    ? { x: to.x + (sign < 0 ? to.width : 0), y: to.y + to.height / 2 }
    : { x: to.x + to.width / 2, y: to.y + (sign < 0 ? to.height : 0) };
  const mid = across ? (start.x + end.x) / 2 : (start.y + end.y) / 2;
  const controls = across ? `${mid} ${start.y + offset}, ${mid} ${end.y + offset}`
    : `${start.x + offset} ${mid}, ${end.x + offset} ${mid}`;
  const tip = `${end.x} ${end.y}`;
  const arrow = across
    ? `M ${end.x - sign * 8} ${end.y - 5} L ${tip} L ${end.x - sign * 8} ${end.y + 5}`
    : `M ${end.x - 5} ${end.y - sign * 8} L ${tip} L ${end.x + 5} ${end.y - sign * 8}`;
  const label = relationLabel(relation);
  const description = relationDescription(relation);
  return <>
    <svg className="flow-relation-line" data-kind={relation.kind} data-coordinator={coordinator} data-selected={selected} width="100%" height="100%" aria-hidden="true">
      <path d={`M ${start.x} ${start.y} C ${controls}, ${tip}`} />
      {relation.kind === "relay" ? <path d={arrow} /> : null}
    </svg>
    <button type="button" className="flow-relation-label" data-kind={relation.kind} aria-pressed={selected}
      data-coordinator={coordinator} data-row-port={rowPort}
      title={description} aria-label={description}
      style={{
        left: coordinator ? end.x - (rowPort ? 22 : 0) : (start.x + end.x) / 2 + (across ? 0 : offset * 0.75),
        top: coordinator ? end.y - (rowPort ? 0 : 15) : (start.y + end.y) / 2 + (across ? offset * 0.75 : 0),
      }}
      onClick={() => onSelect(relation.key)}>
      <HugeiconsIcon icon={relation.kind === "file" ? File01Icon : Message01Icon} size={14} />
      <span>{label}</span>
    </button>
  </>;
}

const ActorNode = memo(function ActorNode({
  area, branch, entry, trace, name, selection, compact, detailed, ambient, clock, time, onSelect, nodeStatus,
}: {
  area: Point;
  branch: FlowBranch;
  entry?: FlowTask;
  trace?: FlowTrace;
  name: string;
  selection: FlowSelection | null;
  compact: boolean;
  detailed: boolean;
  ambient: boolean;
  clock: number;
  time: number | null;
  onSelect: (selection: FlowSelection) => void;
  nodeStatus?: FlowNodeStatus;
}) {
  const run = branch.run;
  const task = entry?.id;
  const actor = useMemo(() => describeActor(branch, entry, trace, time), [branch, entry, trace, time]);
  const current = selection?.run === run.key && selection.task === task;
  const str = (event?: TraceEvent) => onSelect({ run: run.key, ...(task ? { task } : {}), ...(event ? { event: event.id } : {}) });
  const pending = nodeStatus?.pending;
  const notice = nodeStatus?.notice;
  const process = entry?.process;
  const isMarker = !entry && !!run.marker;
  const latestProcessActivity = process ? actor.signals.filter(({ kind }) => kind === "task-activity") : [];
  const activityAt = latestProcessActivity[latestProcessActivity.length - 1]?.at;
  const processIcon = process?.kind === "monitor" ? Radar01Icon : process?.kind === "loop" ? RepeatIcon : TerminalIcon;
  const markerLabel = run.marker === "shell" ? "Shell" : "Terax tasks";
  const working = nodeStatus?.working && actor.tone !== "complete" && actor.tone !== "error" && actor.label !== "Exited";
  const stateLabel = pending ?? (working ? "Working" : isMarker ? markerLabel : actor.label);
  const status = pending ?? (actor.activity && !actor.speech ? eventLabel(actor.activity) : stateLabel);
  const flash = notice && recent(notice.at, time, clock);
  const animate = recent(actor.activity?.at, time, clock);
  const context = actor.usage?.context;
  return (
    <div className="flow-actor" data-tone={pending ? "waiting" : working ? "active" : actor.tone} data-compact={compact}
      data-kind={process ? "process" : isMarker ? run.marker : task ? "subagent" : "agent"} data-notice={notice?.tone}
      style={{ left: area.x, top: area.y,
        "--flow-phase": `${-((area.x * 31 + area.y * 17) % 7000) / 1000}s` } as CSSProperties}>
      <button type="button" className="flow-node" aria-label={`${name}, ${stateLabel}, ${run.tabTitle}${notice && !notice.read ? `, ${notice.label}` : ""}`}
        aria-pressed={current} onClick={() => str()}>
        <span className="flow-beacon">
          {ambient && !isMarker ? (
            <>
              <i className="flow-beacon-aura" aria-hidden="true" />
              <i className="flow-node-orbit" data-idle={actor.tone !== "active"} aria-hidden="true" />
              <i className="flow-node-satellite" aria-hidden="true" />
            </>
          ) : null}
          {!compact && !isMarker ? <BeaconSignals actor={actor} /> : null}
          {animate && !flash ? <i key={actor.activity?.id} className="flow-beacon-wave" aria-hidden="true" /> : null}
          {flash ? <i key={notice.id} className="flow-notice-wave" aria-hidden="true" /> : null}
          <span className="flow-glyph">{process
            ? <HugeiconsIcon icon={processIcon} size={21} />
            : isMarker ? <HugeiconsIcon icon={run.marker === "shell" ? TerminalIcon : Flowchart01Icon} size={21} />
            : <AgentIcon agent={run.agent} harness={run.harness} size={23} />}</span>
          <span className="flow-node-status" aria-hidden="true" />
          {notice && !notice.read ? <span className="flow-notice-mark" aria-hidden="true" title={notice.label} /> : null}
        </span>
        <span className="flow-node-caption" title={name}>{name}</span>
        <span className="flow-node-state">{stateLabel}</span>
        {!compact && actor.usage ? <span className="flow-node-usage">{number.format(actor.usage.tokens)} {actor.usage.outputOnly ? "output tokens" : "tokens"}</span> : null}
        {!compact && context ? <span className="flow-node-context" title={`${context.input.toLocaleString()} / ${context.window.toLocaleString()} input tokens at last request`}>
          {contextPercent(context)}% context
        </span> : null}
        {actor.usage?.cost !== undefined && detailed ? (
          <span className="flow-node-cost" title="Cost reported by this session">${actor.usage.cost.toFixed(actor.usage.cost < 1 ? 3 : 2)}</span>
        ) : null}
      </button>
      {!compact && !isMarker ? (
        <div className="flow-node-events">
          {entry && process ? (
            <div className="flow-activity-label flow-process-label">
              <span>{PROCESS_LABELS[process.kind]}</span>
              <strong>{process.cadence ?? stateLabel}</strong>
              {activityAt !== undefined ? <small>Last activity {activityTime.format(activityAt)}</small>
                : entry.at > 0 ? <small>Started {activityTime.format(entry.at)}</small> : null}
            </div>
          ) : actor.speech?.text ? (
            <button type="button" className="flow-speech" key={actor.speech.id}
              data-new={recent(actor.speech.at, time, clock)}
              data-current={current && selection?.event === actor.speech.id}
              title={actor.speech.text} onClick={() => str(actor.speech)}>
              <span>{actor.speech.kind === "user" ? "Prompt" : eventLabel(actor.speech)}</span>
              <strong>{actor.speech.text}</strong>
            </button>
          ) : <div className="flow-activity-label"><span>{task ? "Subagent" : displayAgent(run.agent)}</span><strong>{status}</strong></div>}
          {actor.tools.length ? (
            <div className="flow-tool-links">
              {actor.tools.slice(0, detailed ? 2 : 1).map((event) => (
                <button type="button" key={event.id} data-new={recent(event.at, time, clock)}
                  data-current={current && selection?.event === event.id}
                  title={event.file ?? eventLabel(event)} onClick={() => str(event)}>
                  <ToolMark name={eventLabel(event)} />
                  <b>{eventLabel(event)}</b>
                  {event.file ? <span className="flow-tool-path">{event.file.split(/[\\/]/).pop()}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

type CanvasProps = {
  branches: readonly FlowBranch[];
  groupedTabs: ReadonlySet<string>;
  traces: ReadonlyMap<string, FlowTrace>;
  direction: FlowDirection;
  arrangement: FlowArrangement;
  time: number | null;
  target: FlowSelection | null;
  pinnedRun: string | null;
  relations: readonly FlowRelation[];
  activeRelation?: FlowRelation;
  nodeStatus: ReadonlyMap<string, FlowNodeStatus>;
  onRelation: (key: string) => void;
  focusRequest: { key: string; tick: number } | null;
  fitRequest: string;
  loading: boolean;
  onSelect: (selection: FlowSelection) => void;
  onVisible: (runs: string[]) => void;
};

export function FlowCanvas({
  branches, groupedTabs, traces, direction, arrangement, time, target, pinnedRun, relations, activeRelation, nodeStatus,
  focusRequest, fitRequest, loading, onSelect, onVisible, onRelation,
}: CanvasProps) {
  const viewport = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState(initialCamera);
  const [autoFit, setAutoFit] = useState(false);
  const [animatingFit, setAnimatingFit] = useState(false);
  const compact = camera.scale < COMPACT_SCALE;
  const layouts = useMemo(() => ({
    expanded: makeScene(branches, direction, arrangement, false, groupedTabs),
    compact: makeScene(branches, direction, arrangement, true, groupedTabs),
  }), [branches, direction, arrangement, groupedTabs]);
  const scene = layouts[compact ? "compact" : "expanded"];
  const { width: nodeWidth, height: nodeHeight, centerY: nodeCenterY } = nodeGeometry(direction, compact);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const minimapId = useId();
  const cameraRef = useRef(initialCamera);
  const frame = useRef<number | null>(null);
  const gesture = useRef<{ pointer: number; start: Point; camera: Camera } | null>(null);
  const fitted = useRef("");
  const manualCamera = useRef(false);
  const fitAllRequested = useRef(false);
  const fittedBounds = useRef("");
  const focused = useRef<number | null>(null);
  const lastAnchor = useRef<{ key: string; position: Point } | null>(null);

  const commit = useCallback((next: Camera, immediate = false) => {
    cameraRef.current = next;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (immediate) {
      frame.current = null;
      setCamera(next);
      return;
    }
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setCamera(cameraRef.current);
    });
  }, []);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!size.width || !size.height) return;
    const { expanded, compact } = layouts;
    if (!expanded.clusters.length) {
      fitted.current = "";
      return;
    }
    if (fitted.current !== fitRequest) {
      fitted.current = fitRequest;
      manualCamera.current = false;
      fitAllRequested.current = false;
      fittedBounds.current = "";
    }
    const topology = autoFit ? expanded.clusters.map(({ branch, nodes }) =>
      JSON.stringify([branch.run.key, nodes.map(({ task }) => task?.id ?? "").sort()])).sort().join("\n") : "";
    const bounds = `${expanded.width}:${expanded.height}:${compact.width}:${compact.height}:${size.width}:${size.height}:${topology}`;
    if ((!autoFit && manualCamera.current) || bounds === fittedBounds.current
      || (pinnedRun && lastAnchor.current && fittedBounds.current)) return;
    setAnimatingFit(autoFit && !!fittedBounds.current);
    fittedBounds.current = bounds;
    const next = arrangement === "lanes" && !fitAllRequested.current && !autoFit
      ? laneCamera(expanded, size) : fitFlowCamera(layouts, size);
    commit(next, true);
  }, [size, layouts, fitRequest, commit, arrangement, pinnedRun, autoFit]);

  useLayoutEffect(() => {
    const pinned = pinnedRun && scene.clusters.find(({ branch }) => branch.run.key === pinnedRun);
    const previous = lastAnchor.current;
    if (!pinned) {
      lastAnchor.current = null;
      return;
    }
    const key = `${fitRequest}:${pinnedRun}:${compact}`;
    const at = pinned.nodes[0].at;
    const position = { x: pinned.box.x + at.x, y: pinned.box.y + at.y };
    lastAnchor.current = { key, position };
    if (previous?.key !== key || (previous.position.x === position.x && previous.position.y === position.y)) return;
    const current = cameraRef.current;
    commit({
      ...current,
      x: current.x + (previous.position.x - position.x) * current.scale,
      y: current.y + (previous.position.y - position.y) * current.scale,
    }, true);
  }, [scene, pinnedRun, fitRequest, commit, compact]);

  useEffect(() => {
    if (!focusRequest || focused.current === focusRequest.tick || !size.width) return;
    const cluster = layouts.expanded.clusters.find(({ branch }) => branch.run.key === focusRequest.key);
    if (!cluster) return;
    focused.current = focusRequest.tick;
    manualCamera.current = true;
    const scale = Math.max(0.7, Math.min(1.1, cameraRef.current.scale));
    const { box, nodes } = cluster;
    const root = nodes[0].at;
    const { width, height } = nodeGeometry(direction);
    commit({
      scale,
      x: size.width / 2 - (box.x + root.x + width / 2) * scale,
      y: size.height / 2 - (box.y + root.y + height / 2) * scale,
    }, true);
  }, [focusRequest, layouts, size, commit, direction]);

  const zoomAt = useCallback((point: Point, factor: number, immediate = false) => {
    setAnimatingFit(false);
    manualCamera.current = true;
    commit(zoomFlowCamera(cameraRef.current, point, factor, layouts, direction, time), immediate);
  }, [commit, direction, layouts, time]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setAnimatingFit(false);
      manualCamera.current = true;
      const current = cameraRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        zoomAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-event.deltaY * 0.008));
      } else {
        const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? element.clientHeight : 1;
        commit({ ...current, x: current.x - event.deltaX * unit, y: current.y - event.deltaY * unit });
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [commit, zoomAt]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const margin = 150 / camera.scale;
  const view: Box = {
    x: -camera.x / camera.scale - margin, y: -camera.y / camera.scale - margin,
    width: size.width / camera.scale + 2 * margin, height: size.height / camera.scale + 2 * margin,
  };
  const visible = scene.clusters.filter((cluster) => overlaps(view, cluster.box));
  const near = visible.map(({ branch }) => branch.run.key).join("\n");
  useEffect(() => {
    onVisible(near ? near.split("\n") : []);
  }, [near, onVisible]);

  function zoom(factor: number) {
    zoomAt({ x: size.width / 2, y: size.height / 2 }, factor, true);
  }

  function panStart(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 0 && (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    setAnimatingFit(false);
    manualCamera.current = true;
    gesture.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, camera: cameraRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "true";
  }

  function panMove(event: PointerEvent<HTMLElement>) {
    const drag = gesture.current;
    if (drag?.pointer !== event.pointerId) return;
    commit({
      ...drag.camera, x: drag.camera.x + event.clientX - drag.start.x,
      y: drag.camera.y + event.clientY - drag.start.y,
    });
  }

  function panEnd(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointer !== event.pointerId) return;
    gesture.current = null;
    delete event.currentTarget.dataset.dragging;
  }

  function navigate(event: KeyboardEvent<HTMLElement>) {
    const directions: Record<string, Point> = {
      ArrowUp: { x: 0, y: 70 }, ArrowDown: { x: 0, y: -70 },
      ArrowLeft: { x: 70, y: 0 }, ArrowRight: { x: -70, y: 0 },
    };
    const movement = directions[event.key];
    if (movement) {
      event.preventDefault();
      setAnimatingFit(false);
      manualCamera.current = true;
      commit({ ...camera, x: camera.x + movement.x, y: camera.y + movement.y }, true);
    } else if (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "0") {
      event.preventDefault();
      if (event.key === "0") fitAll();
      else zoom(event.key === "-" ? 0.82 : 1.22);
    }
  }

  function fitAll() {
    manualCamera.current = false;
    fitAllRequested.current = true;
    setAnimatingFit(true);
    commit(fitFlowCamera(layouts, size), true);
  }

  const detailed = camera.scale >= 0.72;
  const visibleBoxes = new Map(visible.filter(({ branch }) => time === null || branch.start <= time)
    .map(({ branch, box }) => [branch.run.key, box]));
  const coordinatorBox = scene.clusters.find(({ branch }) => branch.run.marker === "terax"
    && (time === null || branch.start <= time))?.box;
  const sourceBox = (relation: FlowRelation) => fromCoordinator(relation) ? coordinatorBox : visibleBoxes.get(relation.from);
  const shown = relations.filter((relation) => sourceBox(relation) && visibleBoxes.has(relation.to));
  const visibleRelations = [...shown.filter(fromCoordinator),
    ...shown.filter((relation) => relation.kind === "relay" && !fromCoordinator(relation)).slice(0, 8),
    ...shown.filter(({ kind }) => kind === "file").slice(0, 8)];
  if (activeRelation && !visibleRelations.some(({ key }) => key === activeRelation.key)) visibleRelations.push(activeRelation);
  const pairOffsets = new Map<string, number>();
  const clock = Date.now();
  let ambientSlots = time === null && !compact ? 16 : 0;
  let pulseSlots = 16;
  return (
    <div className="flow-canvas" data-ambient={time === null}>
      <section className="flow-viewport" ref={viewport} aria-label="Agent map"
        onPointerDown={panStart} onPointerMove={panMove} onPointerUp={panEnd}
        onPointerCancel={panEnd} onLostPointerCapture={panEnd}>
        <div className="flow-atmosphere" aria-hidden="true"
          style={{ transform: `translate(${camera.x * 0.085}px, ${camera.y * 0.085}px)` }}><i /><i /></div>
        <div className="flow-world" data-fit-transition={animatingFit} data-detail={compact ? "compact" : detailed ? "full" : "conversation"} data-direction={direction}
          data-layout={arrangement}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
            "--flow-live-stroke": `${1.5 / camera.scale}px`,
            "--flow-node-center-y": `${nodeCenterY}px`,
            "--flow-node-width": `${nodeWidth}px`,
            "--flow-node-height": `${nodeHeight}px` } as CSSProperties}>
          {visibleRelations.map((relation) => {
            const from = sourceBox(relation);
            const to = visibleBoxes.get(relation.to);
            if (!from || !to) return null;
            const pair = JSON.stringify([relation.from, relation.to].sort());
            const count = pairOffsets.get(pair) ?? 0;
            pairOffsets.set(pair, count + 1);
            const offset = (count % 2 ? 1 : -1) * Math.ceil(count / 2) * 30;
            return <RelationLine key={relation.key} from={from} to={to} relation={relation}
              rowPort={fromCoordinator(relation) && direction === "right"}
              selected={relation.key === activeRelation?.key} offset={offset} onSelect={onRelation} />;
          })}
          {scene.frames.map(({ box, clusters, tab }) => {
            if (!overlaps(view, box)) return null;
            const members = clusters.filter(({ branch }) => time === null || branch.start <= time);
            if (!members.length) return null;
            const { branch } = members[0];
            const active = time === null && members.some(({ branch }) => branch.run.active);
            const linked = members.some(({ branch: { run } }) => activeRelation?.from === run.key || activeRelation?.to === run.key);
            const selected = members.some(({ branch }) => target?.run === branch.run.key);
            const pinned = members.some(({ branch }) => pinnedRun === branch.run.key);
            if (branch.run.marker === "terax") return (
              <section key={branch.run.key} className="flow-coordinator" data-marker="terax" data-linked={linked}
                style={{ left: box.x, top: box.y, width: box.width, height: box.height }} aria-label={branch.run.tabTitle}>
                <button type="button" aria-pressed={target?.run === branch.run.key} onClick={() => onSelect({ run: branch.run.key })}>
                  <HugeiconsIcon icon={Flowchart01Icon} size={21} />
                  <span><strong>{branch.run.tabTitle}</strong><small>Coordinator</small></span>
                </button>
              </section>
            );
            const contents = members.map((cluster) => ({
              ...cluster,
              status: time === null ? nodeStatus.get(cluster.branch.run.key) : undefined,
              show: cluster.nodes.filter(({ task }) => !task || time === null || task.at <= time),
            }));
            const processCount = contents.reduce((count, { show }) => count + show.filter(({ task }) => task?.process).length, 0);
            const agentCount = contents.reduce((count, { branch, show }) => count + show.length - Number(!!branch.run.marker), 0) - processCount;
            const operating = time === null && contents.some(({ branch, status, show }) => {
              const chatWorking = branch.run.group === "terax-ai" && branch.run.active;
              return ((status?.working || chatWorking) && !runOutcome(branch)) || show.some(({ task }) =>
                task && task.returnedAt === undefined && (task.running || task.process?.state === "running"));
            });
            const pulse = operating && pulseSlots > 0;
            if (pulse) pulseSlots--;
            const title = !tab && branch.run.paneLabel ? `${branch.run.tabTitle} · ${branch.run.paneLabel}` : branch.run.tabTitle;
            return (
              <section key={tab ? `tab:${tab}` : branch.run.key} className="flow-cluster" data-active={active}
                data-operating={operating} data-pulse={pulse}
                data-selected={selected} data-pinned={pinned} data-linked={linked}
                data-marker={tab ? undefined : branch.run.marker}
                style={{ ...accent(branch.run), left: box.x, top: box.y, width: box.width, height: box.height }}
                aria-label={title}>
                <div className="flow-cluster-tag"><span /><strong>{title}</strong>
                  {operating ? <b className="flow-cluster-live">Working</b> : null}
                  {agentCount || processCount ? <small>
                    {[pinned ? "Pinned" : "", agentCount ? `${agentCount} ${agentCount === 1 ? "agent" : "agents"}` : "",
                      processCount ? `${processCount} ${processCount === 1 ? "task" : "tasks"}` : ""].filter(Boolean).join(" · ")}
                  </small> : null}</div>
                {contents.map(({ branch, box: area, channel, show, status }) => overlaps(view, area) ? (
                  <div key={branch.run.key} className="flow-cluster-content"
                    style={{ ...accent(branch.run), left: area.x - box.x, top: area.y - box.y, width: area.width, height: area.height }}>
                    {show.length > 1 ? (
                      <svg className="flow-connections" width={area.width} height={area.height} aria-hidden="true">
                        {show.map(({ task, parent, at }) => {
                          if (!parent || !task) return null;
                          const returned = task.returnedAt !== undefined && (time === null || task.returnedAt <= time);
                          const { d, arrow } = edgeGeometry(parent, at, direction, returned, compact, channel);
                          const transit = recent(returned ? task.returnedAt : task.at, time, clock);
                          return (
                            <g key={task.id}>
                              <path d={d} className="flow-edge" data-returned={returned} />
                              <path d={arrow} className="flow-edge-arrow" data-returned={returned} />
                              {transit && !compact ? <path key={`${task.id}:${returned}`} d={d} pathLength="1" className="flow-transit" data-returned={returned} /> : null}
                            </g>
                          );
                        })}
                      </svg>
                    ) : null}
                    {show.map(({ task, at }) => {
                      if (!overlaps(view, { x: area.x + at.x, y: area.y + at.y, width: nodeWidth, height: nodeHeight })) return null;
                      const trace = task ? traces.get(traceKey(task.run) ?? "") : branch.trace;
                      const ambient = ambientSlots > 0;
                      if (ambient) ambientSlots--;
                      return (
                        <ActorNode key={task?.id ?? "root"} area={at} branch={branch} name={task?.label ?? runName(branch.run, branch.trace?.name)}
                          entry={task} trace={trace} selection={target}
                          compact={compact} detailed={detailed || (target?.run === branch.run.key && !compact)}
                          ambient={ambient} clock={clock} time={time} onSelect={onSelect}
                          nodeStatus={!task ? status : undefined} />
                      );
                    })}
                  </div>
                ) : null)}
              </section>
            );
          })}
        </div>
        {!scene.clusters.length ? (
          <div className="flow-empty" role="status">
            <div className="flow-empty-symbol"><HugeiconsIcon icon={Flowchart01Icon} size={28} /></div>
            <h2>{loading ? "Discovering sessions" : "No sessions in view"}</h2>
            <p>{loading ? "Looking for terminal activity and project history." : "Choose another source or start an agent in a Terax terminal."}</p>
          </div>
        ) : null}
      </section>
      <div className="flow-map-dock">
        {scene.clusters.length ? (
          <div id={minimapId} hidden={!minimapOpen}>
            {minimapOpen ? (
              <button type="button" className="flow-minimap" aria-label="Minimap. Click to center, or press Enter to fit all."
                onClick={(event) => {
                  if (!event.detail) {
                    fitAll();
                    return;
                  }
                  const rect = event.currentTarget.querySelector("svg")?.getBoundingClientRect();
                  if (!rect) return;
                  const scale = Math.min(rect.width / scene.width, rect.height / scene.height);
                  if (scale <= 0) return;
                  const x = scene.width / 2 + (event.clientX - rect.left - rect.width / 2) / scale;
                  const y = scene.height / 2 + (event.clientY - rect.top - rect.height / 2) / scale;
                  manualCamera.current = true;
                  commit({ scale: camera.scale, x: size.width / 2 - x * camera.scale, y: size.height / 2 - y * camera.scale }, true);
                }}>
                <svg viewBox={`0 0 ${scene.width} ${scene.height}`} aria-hidden="true">
                  {scene.frames.map(({ box, clusters, tab }) => {
                    const { branch } = clusters[0];
                    return <rect key={tab ? `tab:${tab}` : branch.run.key} x={box.x} y={box.y}
                      width={box.width} height={box.height} rx={12} style={accent(branch.run)}
                      data-active={clusters.some(({ branch }) => branch.run.active)} />;
                  })}
                  <rect className="flow-map-window" x={-camera.x / camera.scale} y={-camera.y / camera.scale}
                    width={size.width / camera.scale} height={size.height / camera.scale} rx={9} />
                </svg>
              </button>
            ) : null}
          </div>
        ) : null}
        <fieldset className="flow-camera" onKeyDown={navigate}>
          <legend className="sr-only">Map navigation. Arrow keys pan, plus and minus zoom, 0 fits the map.</legend>
          {scene.clusters.length ? (
            <button type="button" className="flow-minimap-toggle" aria-controls={minimapId} aria-expanded={minimapOpen}
              aria-label={minimapOpen ? "Hide minimap" : "Show minimap"}
              title={minimapOpen ? "Hide minimap" : "Show minimap"}
              onClick={() => setMinimapOpen((open) => !open)}>
              <HugeiconsIcon icon={MapsIcon} size={14} />
              <HugeiconsIcon icon={minimapOpen ? ArrowDown01Icon : ArrowUp01Icon} size={11} />
            </button>
          ) : null}
          <button type="button" aria-label="Zoom out" disabled={camera.scale <= 0.07} onClick={() => zoom(0.8)}>−</button>
          <span>{Math.round(camera.scale * 100)}%</span>
          <button type="button" aria-label="Zoom in" disabled={camera.scale >= 2.2} onClick={() => zoom(1.25)}>+</button>
          <button type="button" onClick={fitAll}>Fit all</button>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Zoom options" title="Zoom options"><HugeiconsIcon icon={ArrowDown01Icon} size={13} /></button>
            </PopoverTrigger>
            <PopoverContent className="flow-zoom-menu" aria-label="Zoom options" align="start" side="top">
              <label><input type="checkbox" checked={autoFit} onChange={(event) => {
                const enabled = event.target.checked;
                if (enabled) fitAll();
                else setAnimatingFit(false);
                setAutoFit(enabled);
              }} />Auto fit</label>
              <fieldset>
                <legend className="sr-only">Zoom presets</legend>
                {[0.25, 0.5, 1, 1.5, 2].map((scale) => (
                  <button type="button" key={scale} onClick={() => zoom(scale / cameraRef.current.scale)}>
                    {scale * 100}%
                  </button>
                ))}
              </fieldset>
            </PopoverContent>
          </Popover>
        </fieldset>
      </div>
    </div>
  );
}
