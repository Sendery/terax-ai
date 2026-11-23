import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon, ArrowUp01Icon, PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FLOW_LABELS, type FlowKind } from "@/modules/agent-flow/model";
import { nearTick, timeFraction, type TimeLane, type TimeMark } from "@/modules/agent-flow/timeline";
import { TAB_COLOR_CSS } from "@/modules/tabs/lib/tabColors";

export const flowDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
export const flowTime = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

const TONES: Partial<Record<FlowKind, string>> = {
  tool: "tool", delegated: "branch", returned: "return", reply: "speech", user: "speech",
  attention: "alert", error: "alert",
};
const TRACK_RESOLUTION = 10_000;
const DENSITY = 128;

function bucketMarks(marks: readonly TimeMark[], start: number, end: number) {
  const values = new Map<number, { mark: TimeMark; count: number; position: number }>();
  for (const mark of marks) {
    const position = timeFraction(mark.at, start, end);
    const slot = Math.round(position * DENSITY);
    const bin = values.get(slot);
    if (!bin) values.set(slot, { mark, count: 1, position });
    else {
      bin.count++;
      if (!TONES[bin.mark.kind] && TONES[mark.kind]) {
        bin.mark = mark;
        bin.position = position;
      }
    }
  }
  return [...values.values()];
}

type MarkerBins = ReturnType<typeof bucketMarks>;

function TimeMarkers({ bins }: { bins: MarkerBins }) {
  return (
    <span className="flow-time-marks" aria-hidden="true">
      {bins.map(({ mark, count, position }) => (
        <i key={mark.at} data-tone={TONES[mark.kind] ?? "state"}
          style={{ left: `${position * 100}%`, height: Math.min(16, 4 + count * 1.6) }} />
      ))}
    </span>
  );
}

function ShellTrack({
  lane, bins, start, end, cursor, jump,
}: {
  lane: TimeLane;
  bins: MarkerBins;
  start: number;
  end: number;
  cursor: number;
  jump: (at: number | null) => void;
}) {
  const closest = nearTick(lane.marks, cursor);
  return (
    <li className="flow-time-lane" style={{ "--flow-lane-color": lane.color ? TAB_COLOR_CSS[lane.color] : "var(--flow-default)" } as CSSProperties}>
      <div className="flow-time-lane-name" title={lane.description ?? lane.title}>
        <span className="flow-time-lane-dot" data-active={lane.active} />
        <strong>{lane.title}</strong>
        {lane.description && lane.description !== lane.title ? <small>{lane.description}</small> : null}
      </div>
      <button type="button" className="flow-shell-track" aria-label={`Seek events in ${lane.title}${lane.description ? `, ${lane.description}` : ""}`}
        disabled={!closest}
        title={closest ? `${FLOW_LABELS[closest.kind]} · ${flowTime.format(closest.at)}` : "No recorded events"}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = (event.clientX - bounds.left - 5) / Math.max(1, bounds.width - 10);
          const chosen = event.detail ? nearTick(lane.marks, start + point * (end - start)) : closest;
          if (chosen) jump(chosen.at);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const candidate = event.key === "ArrowRight" ? lane.marks.find(({ at }) => at > cursor)
            : [...lane.marks].reverse().find(({ at }) => at < cursor);
          if (candidate) jump(candidate.at);
        }}>
        <TimeMarkers bins={bins} />
        <span className="flow-shell-playhead" aria-hidden="true" />
      </button>
    </li>
  );
}

export function FlowTimeline({
  marks, lanes, time, setTime, playing, setPlaying,
}: {
  marks: readonly TimeMark[];
  lanes: readonly TimeLane[];
  time: number | null;
  setTime: (time: number | null) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
}) {
  const [speed, setSpeed] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const lanesId = useId();
  const start = marks[0]?.at ?? 0;
  const end = marks[marks.length - 1]?.at ?? start;
  const cursor = time ?? end;
  const next = marks.findIndex(({ at }) => at > cursor);
  const index = next < 0 ? marks.length - 1 : Math.max(0, next - 1);
  const previous = marks[index] && marks[index].at < cursor ? index : index - 1;
  const bins = useMemo(() => bucketMarks(marks, start, end), [marks, start, end]);
  const expandedLanes = useMemo(() => expanded
    ? lanes.map((lane) => ({ lane, bins: bucketMarks(lane.marks, start, end) }))
    : [], [expanded, lanes, start, end]);

  useEffect(() => {
    if (!playing || time === null || next < 0) return;
    const target = marks[next].at;
    const timer = setTimeout(() => {
      setTime(target);
      if (next >= marks.length - 1) setPlaying(false);
    }, Math.min(850, Math.max(150, target - time)) / speed);
    return () => clearTimeout(timer);
  }, [playing, time, next, marks, speed, setTime, setPlaying]);

  function jump(at: number | null) {
    setPlaying(false);
    setTime(at);
  }

  const playable = marks.length > 1;
  const progress = timeFraction(cursor, start, end);
  return (
    <section className="flow-timeline" aria-label="Activity timeline"
      style={{ "--flow-progress": `${progress * 100}%` } as CSSProperties}>
      <div className="flow-timeline-main">
        <div className="flow-timeline-controls">
          <button type="button" className="flow-live" aria-pressed={time === null} onClick={() => jump(null)}>
            <span />{time === null ? "Live" : "Go live"}
          </button>
          <div className="flow-transport">
            <button type="button" aria-label="Previous event" disabled={!playable || previous < 0}
              onClick={() => jump(marks[previous].at)}><HugeiconsIcon icon={ArrowLeft01Icon} size={15} /></button>
            <button type="button" aria-label={playing ? "Pause replay" : "Play timeline"} disabled={!playable}
              onClick={() => {
                if (playing) setPlaying(false);
                else {
                  if (time === null || next < 0) setTime(start);
                  setPlaying(true);
                }
              }}><HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={17} /></button>
            <button type="button" aria-label="Next event" disabled={!playable || next < 0}
              onClick={() => jump(marks[next].at)}><HugeiconsIcon icon={ArrowRight01Icon} size={15} /></button>
          </div>
        </div>
        <div className="flow-time-track">
          <div className="flow-time-label">
            <span>{time === null ? "Activity timeline" : flowDate.format(time)}</span>
            <span>{time === null ? `${marks.length} events` : `${index + 1} / ${marks.length}`}</span>
          </div>
          <div className="flow-track-area">
            <TimeMarkers bins={bins} />
            <input aria-label="Timeline position" type="range" min={0} max={TRACK_RESOLUTION}
              value={Math.round(progress * TRACK_RESOLUTION)} disabled={!playable}
              aria-valuetext={marks.length ? flowDate.format(cursor) : "No recorded activity"}
              onChange={(event) => jump(start + Math.round((Number(event.target.value) / TRACK_RESOLUTION) * (end - start)))}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const mark = marks[event.key === "ArrowLeft" ? previous : next];
                if (mark) jump(mark.at);
              }} />
          </div>
        </div>
        <div className="flow-timeline-options">
          <select className="flow-replay-speed" aria-label="Playback speed" value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}>
            <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
          </select>
          <button type="button" className="flow-shell-toggle" aria-controls={lanesId} aria-expanded={expanded}
            title={expanded ? "Hide shell tracks" : "Show one timeline track per shell"}
            aria-label={expanded ? "Hide shell tracks" : "Show shell tracks"}
            disabled={!lanes.length} onClick={() => setExpanded((current) => !current)}>
            <HugeiconsIcon icon={expanded ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
            <span>Shells</span>
          </button>
        </div>
      </div>
      <ul id={lanesId} className="flow-shell-lanes" aria-label="Shell timeline tracks" hidden={!expanded || !expandedLanes.length}>
        {expandedLanes.map(({ lane, bins: laneBins }) => (
          <ShellTrack key={lane.key} lane={lane} bins={laneBins} start={start} end={end} cursor={cursor} jump={jump} />
        ))}
      </ul>
    </section>
  );
}
