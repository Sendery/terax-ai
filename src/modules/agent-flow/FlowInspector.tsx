import { useMemo, useState, type CSSProperties } from "react";
import { Cancel01Icon, TerminalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { displayAgent } from "@/modules/agents/lib/format";
import { relationDescription, relationLabel, type FlowRelation } from "@/modules/agent-flow/coordination";
import { accent, runName } from "@/modules/agent-flow/FlowCanvas";
import { SignalStrip } from "@/modules/agent-flow/FlowSignals";
import { flowTime } from "@/modules/agent-flow/FlowTimeline";
import { beforeTime, FLOW_LABELS, PROCESS_LABELS, type FlowTask, type TraceEvent } from "@/modules/agent-flow/model";
import { contextPercent, describeActor, eventLabel, processEvents, type Actor, type FlowBranch } from "@/modules/agent-flow/scene";
import type { FlowTrace } from "@/modules/agent-flow/traceReader";

const GROUPS = ["Activity", "Messages", "Tools", "Files"] as const;
const PAGE = 32;

export function UsageMetrics({ usage }: { usage: NonNullable<Actor["usage"]> }) {
  const context = usage.context;
  return (
    <dl className="flow-usage">
      <div><dt>Reported tokens</dt><dd>{usage.tokens.toLocaleString()}</dd></div>
      {usage.cost !== undefined ? <div><dt>Reported cost</dt><dd>${usage.cost.toFixed(usage.cost < 1 ? 3 : 2)}</dd></div> : null}
      {context ? <div className="flow-context-meter">
        <dt>Input tokens at last request</dt>
        <dd>{context.input.toLocaleString()} / {context.window.toLocaleString()}</dd>
        <meter min={0} max={100} value={contextPercent(context)} aria-label="Context window occupancy" />
      </div> : null}
    </dl>
  );
}

export function FlowInspector({
  branch, task, trace, eventId, time, onClose, onJump, onActivate, onRoot, pinned, onPin, relations, onRelation, pending,
}: {
  branch: FlowBranch;
  task?: FlowTask;
  trace: FlowTrace | undefined;
  eventId?: string;
  time: number | null;
  onClose: () => void;
  onJump: (at: number) => void;
  onActivate: (tabId: number, leafId: number) => void;
  onRoot: () => void;
  pinned: boolean;
  onPin: () => void;
  relations: readonly FlowRelation[];
  onRelation: (key: string) => void;
  pending?: string;
}) {
  const [mode, setMode] = useState<(typeof GROUPS)[number]>("Activity");
  const [limit, setLimit] = useState(PAGE);
  const [stat, setStat] = useState<string | null>(null);
  const run = branch.run;
  const relevant = useMemo(() => {
    const events = beforeTime(task?.run ? trace?.events ?? [] : branch.events, time).filter(
      (event) => event.kind !== "usage" && (task?.run || !task || event.taskId === task.id || event.id === task.id),
    );
    return task?.process ? processEvents(task, events, time) : events;
  }, [branch.events, task, time, trace?.events]);
  const actor = describeActor(branch, task, trace, time);
  const focused = relevant.find((event) => event.id === eventId);
  const filtered = [...relevant].reverse().filter((event) => {
    if (mode === "Messages") return event.kind === "reply" || event.kind === "user" || event.kind === "attention";
    if (mode === "Tools") return event.kind === "tool" && (!stat || event.text === stat);
    if (mode === "Files") return event.file && (!stat || event.file === stat);
    return event.kind !== "returned" || !!task || branch.tasks.some((entry) => entry.id === event.taskId);
  });
  const counts = new Map<string, TraceEvent[]>();
  if (mode === "Tools" || mode === "Files") {
    for (const event of relevant) {
      const key = mode === "Tools" && event.kind === "tool" ? event.text : mode === "Files" ? event.file : undefined;
      if (!key) continue;
      const events = counts.get(key) ?? [];
      events.push(event);
      counts.set(key, events);
    }
  }
  const stats = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <aside className="flow-inspector" aria-label="Agent details" style={accent(run)}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <header className="flow-inspector-header">
        <div><span className="flow-tab-dot" /><strong>{run.tabTitle}</strong></div>
        <button type="button" className="flow-icon-button" aria-label="Close agent details" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={17} />
        </button>
      </header>
      <div className="flow-inspector-title">
        <h2>{task?.label ?? runName(run, trace?.name)}</h2>
        {task?.process
          ? <p>{PROCESS_LABELS[task.process.kind]} <span>·</span> {actor.label}{task.process.cadence ? ` · ${task.process.cadence}` : ""}</p>
          : <p>{displayAgent(run.agent)} <span>·</span> {task ? "Subagent" : pending ?? actor.label}</p>}
        <div className="flow-inspector-actions">
          <button type="button" aria-pressed={pinned} onClick={onPin}>{pinned ? "Unpin session" : "Pin session"}</button>
          {task ? <button type="button" onClick={onRoot}>Go to session</button> : null}
          {run.tabId !== undefined && run.leafId !== undefined && run.active ? (
            <button type="button" onClick={() => {
              if (run.tabId !== undefined && run.leafId !== undefined) onActivate(run.tabId, run.leafId);
            }}><HugeiconsIcon icon={TerminalIcon} size={14} /> Focus terminal</button>
          ) : null}
        </div>
      </div>
      <fieldset className="flow-inspector-tabs">
        <legend className="sr-only">Detail views</legend>
        {GROUPS.map((entry) => <button type="button" key={entry} aria-pressed={mode === entry}
          onClick={() => { setMode(entry); setLimit(PAGE); setStat(null); }}>{entry}</button>)}
      </fieldset>
      <div className="flow-inspector-scroll">
        {actor.signals.length && mode === "Activity" ? (
          <div className="flow-inspector-signals">
            <span>Recent signals</span>
            <SignalStrip events={actor.signals} onSelect={(event) => onJump(event.at)} />
          </div>
        ) : null}
        {focused ? <div className="flow-inspector-focus" key={focused.id}>
          <small>{FLOW_LABELS[focused.kind]} · {flowTime.format(focused.at)}</small>
          <strong>{focused.text || eventLabel(focused)}</strong>
          {focused.file ? <span>{focused.file}</span> : null}
          <button type="button" onClick={() => onJump(focused.at)}>Jump to event</button>
        </div> : null}
        {actor.usage && mode === "Activity" ? <UsageMetrics usage={actor.usage} /> : null}
        {!task && mode === "Activity" && relations.length ? (
          <div className="flow-inspector-actions flow-inspector-links">
            {relations.slice(0, 8).map((relation) => (
              <button type="button" key={relation.key} data-kind={relation.kind} aria-label={relationDescription(relation)}
                onClick={() => onRelation(relation.key)}>{relationLabel(relation)}</button>
            ))}
          </div>
        ) : null}
        {stats.length ? <ul className="flow-stat-list">
          {stats.map(([key, events]) => <li key={key}>
            <button type="button" title={key} aria-pressed={stat === key}
              style={{ "--flow-stat": `${events.length / stats[0][1].length * 100}%` } as CSSProperties}
              onClick={() => { setStat((current) => current === key ? null : key); setLimit(PAGE); }}>
              <span>{key}</span><b>{events.length}</b>
            </button>
          </li>)}
        </ul> : null}
        {trace?.failed ? <p className="flow-inspector-note">Transcript unavailable. Showing recorded events.</p> : null}
        {trace?.limited ? <p className="flow-inspector-note">Showing recent transcript activity.</p> : null}
        {run.projectHistory ? <p className="flow-inspector-note">Matched by project folder.</p> : null}
        {filtered.length ? <ol className="flow-event-list">
          {filtered.slice(0, limit).map((event) => <li key={event.id}>
            <button type="button" aria-current={event.at === time ? "step" : undefined} onClick={() => onJump(event.at)}>
              <span><b>{eventLabel(event)}</b><time dateTime={new Date(event.at).toISOString()}>{flowTime.format(event.at)}</time></span>
              {event.kind !== "tool" && event.text ? <small>{event.text}</small> : null}
              {event.file ? <small>{event.file}</small> : null}
            </button>
          </li>)}
        </ol> : <p className="flow-inspector-note">No {mode.toLowerCase()} at this point in the timeline.</p>}
        {filtered.length > limit ? <button type="button" onClick={() => setLimit((count) => count + PAGE)}>Earlier events</button> : null}
      </div>
    </aside>
  );
}
