import {
  type CSSProperties, type KeyboardEvent, type PointerEvent,
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { ArrowDown01Icon, ArrowRight01Icon, File01Icon, Flowchart01Icon, Message01Icon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import { relationLabel, type FlowNodeStatus, type FlowRelation } from "@/modules/agent-flow/coordination";
import { TAB_COLOR_CSS } from "@/modules/tabs/lib/tabColors";
import { BeaconSignals, ToolMark } from "@/modules/agent-flow/FlowSignals";
import type { FlowDirection, FlowRun, FlowTask, TraceEvent } from "@/modules/agent-flow/model";
import {
  contextPercent, describeActor, edgeGeometry, eventLabel, fitCamera, laneCamera, NODE_HEIGHT, NODE_WIDTH, overlaps, zoomCamera,
  type Box, type Camera, type FlowArrangement, type FlowBranch, type FlowScene, type FlowSelection, type Point,
} from "@/modules/agent-flow/scene";
import { traceKey, type FlowTrace } from "@/modules/agent-flow/traceReader";

const number = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
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

function RelationLine({ from, to, relation, selected, offset, onSelect }: {
  from: Box; to: Box; relation: FlowRelation; selected: boolean; offset: number; onSelect: (key: string) => void;
}) {
  const across = from.x + from.width <= to.x || to.x + to.width <= from.x;
  const sign = (across ? to.x - from.x : to.y - from.y) < 0 ? -1 : 1;
  const start = across
    ? { x: from.x + (sign > 0 ? from.width : 0), y: from.y + from.height / 2 }
    : { x: from.x + from.width / 2, y: from.y + (sign > 0 ? from.height : 0) };
  const end = across
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
  return <>
    <svg className="flow-relation-line" data-kind={relation.kind} data-selected={selected} width="100%" height="100%" aria-hidden="true">
      <path d={`M ${start.x} ${start.y} C ${controls}, ${tip}`} />
      {relation.kind === "relay" ? <path d={arrow} /> : null}
    </svg>
    <button type="button" className="flow-relation-label" data-kind={relation.kind} aria-pressed={selected}
      title={label} aria-label={`Inspect ${relation.kind === "file" ? `shared file ${label}` : label.toLowerCase()}`}
      style={{ left: (start.x + end.x) / 2 + (across ? 0 : offset * 0.75),
        top: (start.y + end.y) / 2 + (across ? offset * 0.75 : 0) }}
      onClick={() => onSelect(relation.key)}>
      <HugeiconsIcon icon={relation.kind === "file" ? File01Icon : Message01Icon} size={14} />
      <span>{label}</span>
    </button>
  </>;
}

const ActorNode = memo(function ActorNode({
  area, branch, entry, trace, name, selection, compact, detailed, ambient, clock, time, onSelect, nodeStatus, motion,
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
  motion: boolean;
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
  const stateLabel = pending ?? (run.marker ? (run.marker === "shell" ? "Shell" : "Command source") : actor.label);
  const status = pending ?? (actor.activity && !actor.speech ? eventLabel(actor.activity) : stateLabel);
  const flash = notice && motion && recent(notice.at, time, clock);
  const animate = recent(actor.activity?.at, time, clock);
  const context = actor.usage?.context;
  return (
    <div className="flow-actor" data-tone={pending ? "waiting" : actor.tone} data-compact={compact}
      data-kind={run.marker ?? (task ? "subagent" : "agent")} data-notice={notice?.tone}
      style={{ left: area.x, top: area.y, width: NODE_WIDTH, height: NODE_HEIGHT,
        "--flow-phase": `${-((area.x * 31 + area.y * 17) % 7000) / 1000}s` } as CSSProperties}>
      <button type="button" className="flow-node" aria-label={`${name}, ${stateLabel}, ${run.tabTitle}${notice && !notice.read ? `, ${notice.label}` : ""}`}
        aria-pressed={current} onClick={() => str()}>
        <span className="flow-beacon">
          {ambient && !run.marker ? (
            <>
              <i className="flow-beacon-aura" aria-hidden="true" />
              <i className="flow-node-orbit" data-idle={actor.tone !== "active"} aria-hidden="true" />
              <i className="flow-node-satellite" aria-hidden="true" />
            </>
          ) : null}
          {!compact && !run.marker ? <BeaconSignals actor={actor} /> : null}
          {animate && !flash ? <i key={actor.activity?.id} className="flow-beacon-wave" aria-hidden="true" /> : null}
          {flash ? <i key={notice.id} className="flow-notice-wave" aria-hidden="true" /> : null}
          <span className="flow-glyph">{run.marker
            ? <HugeiconsIcon icon={run.marker === "terax" ? Flowchart01Icon : TerminalIcon} size={21} />
            : <AgentIcon agent={run.agent} harness={run.harness} size={23} />}</span>
          <span className="flow-node-status" aria-hidden="true" />
          {notice && !notice.read ? <span className="flow-notice-mark" aria-hidden="true" title={notice.label} /> : null}
        </span>
        <span className="flow-node-caption" title={name}>{name}</span>
        <span className="flow-node-state">{stateLabel}</span>
        {detailed && actor.usage ? <span className="flow-node-usage">{number.format(actor.usage.tokens)} tokens</span> : null}
        {detailed && context ? <span className="flow-node-context" title={`${context.input.toLocaleString()} / ${context.window.toLocaleString()} input tokens at last request`}>
          {contextPercent(context)}% context
        </span> : null}
        {actor.usage?.cost !== undefined && detailed ? (
          <span className="flow-node-cost" title="Cost reported by this session">${actor.usage.cost.toFixed(actor.usage.cost < 1 ? 3 : 2)}</span>
        ) : null}
      </button>
      {!compact && !run.marker ? (
        <div className="flow-node-events">
          {actor.speech?.text ? (
            <button type="button" className="flow-speech" key={actor.speech.id}
              data-new={recent(actor.speech.at, time, clock)}
              data-current={current && selection?.event === actor.speech.id}
              title={actor.speech.text} onClick={() => str(actor.speech)}>
              <span>{actor.speech.kind === "user" ? "Prompt" : eventLabel(actor.speech)}</span>
              <strong>{actor.speech.text}</strong>
            </button>
          ) : <div className="flow-activity-label"><span>{task ? "Subagent" : displayAgent(run.agent)}</span><strong>{status}</strong></div>}
          {detailed && actor.tools.length ? (
            <div className="flow-tool-links">
              {actor.tools.map((event) => (
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
  scene: FlowScene;
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
  motion: boolean;
  onSelect: (selection: FlowSelection) => void;
  onVisible: (runs: string[]) => void;
};

export function FlowCanvas({
  scene, traces, direction, arrangement, time, target, pinnedRun, relations, activeRelation, nodeStatus,
  focusRequest, fitRequest, loading, motion, onSelect, onVisible, onRelation,
}: CanvasProps) {
  const viewport = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState(initialCamera);
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
    if (!scene.clusters.length) {
      fitted.current = "";
      return;
    }
    if (fitted.current !== fitRequest) {
      fitted.current = fitRequest;
      manualCamera.current = false;
      fitAllRequested.current = false;
      fittedBounds.current = "";
    }
    const bounds = `${scene.width}:${scene.height}:${size.width}:${size.height}`;
    if (manualCamera.current || bounds === fittedBounds.current || (pinnedRun && lastAnchor.current && fittedBounds.current)) return;
    fittedBounds.current = bounds;
    const next = arrangement === "lanes" && !fitAllRequested.current
      ? laneCamera(scene, size) : fitCamera(scene, size);
    commit(next, true);
  }, [size, scene, fitRequest, commit, arrangement, pinnedRun]);

  useLayoutEffect(() => {
    const pinned = pinnedRun && scene.clusters.find(({ branch }) => branch.run.key === pinnedRun);
    const previous = lastAnchor.current;
    if (!pinned) {
      lastAnchor.current = null;
      return;
    }
    const key = `${fitRequest}:${pinnedRun}`;
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
  }, [scene, pinnedRun, fitRequest, commit]);

  useEffect(() => {
    if (!focusRequest || focused.current === focusRequest.tick || !size.width) return;
    const cluster = scene.clusters.find(({ branch }) => branch.run.key === focusRequest.key);
    if (!cluster) return;
    focused.current = focusRequest.tick;
    manualCamera.current = true;
    const scale = Math.max(0.7, Math.min(1.1, cameraRef.current.scale));
    const { box, nodes } = cluster;
    const root = nodes[0].at;
    commit({
      scale,
      x: size.width / 2 - (box.x + root.x + NODE_WIDTH / 2) * scale,
      y: size.height / 2 - (box.y + root.y + NODE_HEIGHT / 2) * scale,
    }, true);
  }, [focusRequest, scene, size, commit]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      manualCamera.current = true;
      const current = cameraRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        commit(zoomCamera(current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-event.deltaY * 0.008)));
      } else {
        const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? element.clientHeight : 1;
        commit({ ...current, x: current.x - event.deltaX * unit, y: current.y - event.deltaY * unit });
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [commit]);

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
    manualCamera.current = true;
    commit(zoomCamera(cameraRef.current, { x: size.width / 2, y: size.height / 2 }, factor), true);
  }

  function panStart(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 0 && (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
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
    commit(fitCamera(scene, size), true);
  }

  const compact = camera.scale < 0.48;
  const detailed = camera.scale >= 0.72;
  const visibleBoxes = new Map(visible.filter(({ branch }) => time === null || branch.start <= time)
    .map(({ branch, box }) => [branch.run.key, box]));
  const shown = relations.filter(({ from, to }) => visibleBoxes.has(from) && visibleBoxes.has(to));
  const visibleRelations = [...shown.filter(({ kind }) => kind === "relay").slice(0, 8),
    ...shown.filter(({ kind }) => kind === "file").slice(0, 8)];
  if (activeRelation && !visibleRelations.some(({ key }) => key === activeRelation.key)) visibleRelations.push(activeRelation);
  const pairOffsets = new Map<string, number>();
  const clock = useMemo(() => scene.clusters.length ? Date.now() : 0, [scene, nodeStatus, time]);
  const mapScale = Math.min(152 / scene.width, 94 / scene.height);
  const mapWidth = scene.width * mapScale;
  const mapHeight = scene.height * mapScale;
  let ambientSlots = !motion || time !== null || compact ? 0 : 16;
  return (
    <div className="flow-canvas" data-ambient={motion && time === null}>
      <section className="flow-viewport" ref={viewport} aria-label="Agent map"
        onPointerDown={panStart} onPointerMove={panMove} onPointerUp={panEnd}
        onPointerCancel={panEnd} onLostPointerCapture={panEnd}>
        <div className="flow-atmosphere" aria-hidden="true"
          style={{ transform: `translate(${camera.x * 0.085}px, ${camera.y * 0.085}px)` }}><i /><i /></div>
        <div className="flow-world" data-detail={compact ? "compact" : detailed ? "full" : "conversation"} data-direction={direction}
          data-layout={arrangement}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
          {visibleRelations.map((relation) => {
            const from = visibleBoxes.get(relation.from);
            const to = visibleBoxes.get(relation.to);
            if (!from || !to) return null;
            const pair = JSON.stringify([relation.from, relation.to].sort());
            const count = pairOffsets.get(pair) ?? 0;
            pairOffsets.set(pair, count + 1);
            const offset = (count % 2 ? 1 : -1) * Math.ceil(count / 2) * 30;
            return <RelationLine key={relation.key} from={from} to={to} relation={relation}
              selected={relation.key === activeRelation?.key} offset={offset} onSelect={onRelation} />;
          })}
          {visible.map(({ branch, box, nodes }) => {
            if (time !== null && branch.start > time) return null;
            const show = nodes.filter(({ task }) => !task || time === null || task.at <= time);
            return (
              <section key={branch.run.key} className="flow-cluster" data-active={!!branch.run.active && time === null}
                data-selected={target?.run === branch.run.key}
                data-pinned={pinnedRun === branch.run.key}
                data-linked={activeRelation?.from === branch.run.key || activeRelation?.to === branch.run.key}
                data-marker={branch.run.marker}
                style={{ ...accent(branch.run), left: box.x, top: box.y, width: box.width, height: box.height }}
                aria-label={branch.run.tabTitle}>
                <div className="flow-cluster-tag"><span />{branch.run.tabTitle}{branch.run.paneLabel ? ` · ${branch.run.paneLabel}` : ""}
                  {!branch.run.marker ? <small>{pinnedRun === branch.run.key ? "Pinned · " : ""}{show.length} {show.length === 1 ? "agent" : "agents"}</small> : null}</div>
                {show.length > 1 ? (
                  <svg className="flow-connections" width={box.width} height={box.height} aria-hidden="true">
                    {show.map(({ task, parent, at }) => {
                      if (!parent || !task) return null;
                      const returned = task.returnedAt !== undefined && (time === null || task.returnedAt <= time);
                      const { d, arrow } = edgeGeometry(parent, at, direction, returned);
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
                  if (!overlaps(view, { x: box.x + at.x, y: box.y + at.y, width: NODE_WIDTH, height: NODE_HEIGHT })) return null;
                  const trace = task ? traces.get(traceKey(task.run) ?? "") : branch.trace;
                  const ambient = ambientSlots > 0;
                  if (ambient) ambientSlots--;
                  return (
                    <ActorNode key={task?.id ?? "root"} area={at} branch={branch} name={task?.label ?? runName(branch.run, branch.trace?.name)}
                      entry={task} trace={trace} selection={target}
                      compact={compact} detailed={detailed || (target?.run === branch.run.key && !compact)}
                      ambient={ambient} clock={clock} time={time} onSelect={onSelect} motion={motion && time === null}
                      nodeStatus={!task && time === null ? nodeStatus.get(branch.run.key) : undefined} />
                  );
                })}
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
      <fieldset className="flow-camera" onKeyDown={navigate}>
        <legend className="sr-only">Map navigation. Arrow keys pan, plus and minus zoom, 0 fits the map.</legend>
        <button type="button" aria-label="Zoom out" disabled={camera.scale <= 0.07} onClick={() => zoom(0.8)}>−</button>
        <span>{Math.round(camera.scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={camera.scale >= 2.2} onClick={() => zoom(1.25)}>+</button>
        <button type="button" onClick={fitAll}>Fit all</button>
        <HugeiconsIcon icon={direction === "down" ? ArrowDown01Icon : ArrowRight01Icon} size={13} />
      </fieldset>
      {scene.clusters.length ? (
        <button type="button" className="flow-minimap" aria-label="Minimap. Click to center, or press Enter to fit all."
          onClick={(event) => {
            if (!event.detail) {
              fitAll();
              return;
            }
            const rect = event.currentTarget.querySelector("svg")?.getBoundingClientRect();
            if (!rect) return;
            manualCamera.current = true;
            commit({
              scale: camera.scale,
              x: size.width / 2 - (event.clientX - rect.left) / mapScale * camera.scale,
              y: size.height / 2 - (event.clientY - rect.top) / mapScale * camera.scale,
            }, true);
          }}>
          <svg width={mapWidth} height={mapHeight} viewBox={`0 0 ${scene.width} ${scene.height}`} aria-hidden="true">
            {scene.clusters.map(({ box, branch }) => (
              <rect key={branch.run.key} x={box.x} y={box.y} width={box.width} height={box.height} rx={12}
                style={accent(branch.run)} data-active={!!branch.run.active} />
            ))}
            <rect className="flow-map-window" x={-camera.x / camera.scale} y={-camera.y / camera.scale}
              width={size.width / camera.scale} height={size.height / camera.scale} rx={9} />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
