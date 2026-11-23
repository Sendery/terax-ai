import {
  type CSSProperties, type KeyboardEvent, type PointerEvent,
  useEffect, useLayoutEffect, useRef, useState,
} from "react";
import { ArrowDown01Icon, ArrowLeft01Icon, Flowchart01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import { TAB_COLOR_CSS } from "@/modules/tabs/lib/tabColors";
import type { FlowDirection, FlowRun, TraceEvent } from "@/modules/agent-flow/model";
import {
  describeActor, eventLabel, fitCamera, NODE_ANCHOR, NODE_HEIGHT, NODE_WIDTH, overlaps, zoomCamera,
  type Actor, type Box, type Camera, type FlowScene, type FlowSelection, type Point,
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

function pathBetween(from: Point, to: Point, direction: FlowDirection) {
  const a = { x: from.x + NODE_ANCHOR.x, y: from.y + NODE_ANCHOR.y };
  const b = { x: to.x + NODE_ANCHOR.x, y: to.y + NODE_ANCHOR.y };
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;
  return direction === "down"
    ? `M ${a.x} ${a.y + 29} C ${a.x} ${y}, ${b.x} ${y}, ${b.x} ${b.y - 29}`
    : `M ${a.x - 29} ${a.y} C ${x} ${a.y}, ${x} ${b.y}, ${b.x + 29} ${b.y}`;
}

function recent(event: number | undefined, time: number | null, clock: number) {
  return event !== undefined && (time === null ? Math.abs(clock - event) < 6000 : event === time);
}

function ActorNode({
  area, actor, run, name, task, selection, compact, clock, time, onSelect,
}: {
  area: Point;
  actor: Actor;
  run: FlowRun;
  name: string;
  task?: string;
  selection: FlowSelection | null;
  compact: boolean;
  clock: number;
  time: number | null;
  onSelect: (selection: FlowSelection) => void;
}) {
  const current = selection?.run === run.key && selection.task === task;
  const str = (event?: TraceEvent) => onSelect({ run: run.key, ...(task ? { task } : {}), ...(event ? { event: event.id } : {}) });
  const status = actor.activity && !actor.speech ? eventLabel(actor.activity) : actor.label;
  const animate = recent(actor.activity?.at, time, clock);
  return (
    <div className="flow-actor" data-tone={actor.tone} data-compact={compact} data-kind={task ? "subagent" : "agent"}
      style={{ left: area.x, top: area.y, width: NODE_WIDTH, height: NODE_HEIGHT }}>
      <button type="button" className="flow-node" aria-label={`${name}, ${actor.label}, ${run.tabTitle}`}
        aria-pressed={current} onClick={() => str()}>
        <span className="flow-beacon">
          {animate ? <i key={actor.activity?.id} className="flow-beacon-wave" aria-hidden="true" /> : null}
          {!compact && time === null && actor.tone === "active" ? <i className="flow-node-orbit" aria-hidden="true" /> : null}
          <span className="flow-glyph"><AgentIcon agent={run.agent} harness={run.harness} size={23} /></span>
          <span className="flow-node-status" aria-hidden="true" />
        </span>
        <span className="flow-node-caption" title={name}>{name}</span>
        <span className="flow-node-state">{actor.label}</span>
        {actor.usage ? <span className="flow-node-usage">{number.format(actor.usage.tokens)} tokens</span> : null}
      </button>
      {!compact ? (
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
          {actor.tools.length ? (
            <div className="flow-tool-links">
              {actor.tools.map((event) => (
                <button type="button" key={event.id} data-new={recent(event.at, time, clock)}
                  data-current={current && selection?.event === event.id}
                  title={event.file ?? eventLabel(event)} onClick={() => str(event)}>
                  <b aria-hidden="true">›</b> {eventLabel(event)}
                  {event.file ? <span>{event.file.split(/[\\/]/).pop()}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type CanvasProps = {
  scene: FlowScene;
  traces: ReadonlyMap<string, FlowTrace>;
  direction: FlowDirection;
  time: number | null;
  target: FlowSelection | null;
  focusRequest: { key: string; tick: number } | null;
  fitRequest: string;
  loading: boolean;
  onSelect: (selection: FlowSelection) => void;
  onVisible: (runs: string[]) => void;
};

export function FlowCanvas({
  scene, traces, direction, time, target, focusRequest, fitRequest, loading, onSelect, onVisible,
}: CanvasProps) {
  const viewport = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState(initialCamera);
  const cameraRef = useRef(initialCamera);
  const frame = useRef<number | null>(null);
  const gesture = useRef<{ pointer: number; start: Point; camera: Camera } | null>(null);
  const fitted = useRef("");
  const manualCamera = useRef(false);
  const fittedBounds = useRef("");
  const focused = useRef<number | null>(null);

  function commit(next: Camera, immediate = false) {
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
  }

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
      fittedBounds.current = "";
    }
    const bounds = `${scene.width}:${scene.height}:${size.width}:${size.height}`;
    if (manualCamera.current || bounds === fittedBounds.current) return;
    fittedBounds.current = bounds;
    commit(fitCamera(scene, size), true);
  }, [size, scene, fitRequest]);

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
  }, [focusRequest, scene, size]);

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
    if ((event.target as HTMLElement).closest("button")) return;
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
    commit(fitCamera(scene, size), true);
  }

  const compact = camera.scale < 0.48;
  const clock = Date.now();
  const mapScale = Math.min(152 / scene.width, 94 / scene.height);
  const mapWidth = scene.width * mapScale;
  const mapHeight = scene.height * mapScale;
  return (
    <div className="flow-canvas">
      <section className="flow-viewport" ref={viewport} role="application" aria-label="Agent map. Arrow keys pan, plus and minus zoom, 0 fits the map."
        tabIndex={0} onKeyDown={navigate} onPointerDown={panStart} onPointerMove={panMove} onPointerUp={panEnd}
        onPointerCancel={panEnd} onLostPointerCapture={panEnd}>
        <div className="flow-world" data-detail={compact ? "compact" : "full"}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
          {visible.map(({ branch, box, nodes }) => {
            if (time !== null && branch.start > time) return null;
            const show = nodes.filter(({ task }) => !task || time === null || task.at <= time);
            return (
              <section key={branch.run.key} className="flow-cluster" data-active={!!branch.run.active && time === null}
                style={{ ...accent(branch.run), left: box.x, top: box.y, width: box.width, height: box.height }}
                aria-label={branch.run.tabTitle}>
                <div className="flow-cluster-tag"><span />{branch.run.tabTitle}<small>{show.length} {show.length === 1 ? "agent" : "agents"}</small></div>
                {show.length > 1 ? (
                  <svg className="flow-connections" width={box.width} height={box.height} aria-hidden="true">
                    {show.map(({ task, parent, at }) => {
                      if (!parent || !task) return null;
                      const d = pathBetween(parent, at, direction);
                      const returned = task.returnedAt !== undefined && (time === null || task.returnedAt <= time);
                      const transit = recent(returned ? task.returnedAt : task.at, time, clock);
                      return (
                        <g key={task.id}>
                          <path d={d} className="flow-edge" data-returned={returned} />
                          {transit && !compact ? <path key={`${task.id}:${returned}`} d={d} pathLength="1" className="flow-transit" data-returned={returned} /> : null}
                        </g>
                      );
                    })}
                  </svg>
                ) : null}
                {show.map(({ task, at }) => {
                  if (!overlaps(view, { x: box.x + at.x, y: box.y + at.y, width: NODE_WIDTH, height: NODE_HEIGHT })) return null;
                  const trace = task?.run ? traces.get(traceKey(task.run) ?? "") : branch.trace;
                  return (
                    <ActorNode key={task?.id ?? "root"} area={at} run={branch.run} name={task?.label ?? runName(branch.run, branch.trace?.name)}
                      actor={describeActor(branch, task, trace, time)} task={task?.id} selection={target}
                      compact={compact} clock={clock} time={time} onSelect={onSelect} />
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
      <div className="flow-camera">
        <button type="button" aria-label="Zoom out" disabled={camera.scale <= 0.07} onClick={() => zoom(0.8)}>−</button>
        <span aria-label="Zoom level">{Math.round(camera.scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={camera.scale >= 2.2} onClick={() => zoom(1.25)}>+</button>
        <button type="button" onClick={fitAll}>Fit all</button>
        <HugeiconsIcon icon={direction === "down" ? ArrowDown01Icon : ArrowLeft01Icon} size={13} />
      </div>
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
