import { useEffect, useMemo, useState } from "react";
import { ArrowLeft01Icon, ArrowRight01Icon, PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { FlowKind } from "@/modules/agent-flow/model";
import type { CSSProperties } from "react";

export type TimeMark = { at: number; kind: FlowKind };
export const flowDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
export const flowTime = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

const TONES: Partial<Record<FlowKind, string>> = {
  tool: "tool", delegated: "branch", returned: "return", reply: "speech", user: "speech",
  attention: "alert", error: "alert",
};

export function FlowTimeline({
  marks, time, setTime, playing, setPlaying,
}: {
  marks: readonly TimeMark[];
  time: number | null;
  setTime: (time: number | null) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
}) {
  const [speed, setSpeed] = useState(1);
  const next = time === null ? -1 : marks.findIndex(({ at }) => at > time);
  const index = next < 0 ? marks.length - 1 : Math.max(0, next - 1);
  const bins = useMemo(() => {
    const count = Math.min(96, marks.length);
    return Array.from({ length: count }, (_, slot) => {
      const batch = marks.slice(Math.floor(slot * marks.length / count), Math.floor((slot + 1) * marks.length / count));
      const event = batch.find((mark) => TONES[mark.kind]) ?? batch[0];
      return { at: event.at, tone: TONES[event.kind] ?? "state", count: batch.length };
    });
  }, [marks]);

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
  const progress = marks.length > 1 ? Math.max(0, index) / (marks.length - 1) * 100 : 0;
  return (
    <section className="flow-timeline" aria-label="Activity timeline">
      <button type="button" className="flow-live" aria-pressed={time === null} onClick={() => jump(null)}>
        <span />{time === null ? "Live" : "Go live"}
      </button>
      <div className="flow-transport">
        <button type="button" aria-label="Previous event" disabled={!playable || index <= 0}
          onClick={() => jump(marks[index - 1].at)}><HugeiconsIcon icon={ArrowLeft01Icon} size={15} /></button>
        <button type="button" aria-label={playing ? "Pause replay" : "Play timeline"} disabled={!playable}
          onClick={() => {
            if (playing) {
              setPlaying(false);
            } else {
              if (time === null || index >= marks.length - 1) setTime(marks[0].at);
              setPlaying(true);
            }
          }}><HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} size={17} /></button>
        <button type="button" aria-label="Next event" disabled={!playable || index >= marks.length - 1}
          onClick={() => jump(marks[index + 1].at)}><HugeiconsIcon icon={ArrowRight01Icon} size={15} /></button>
      </div>
      <div className="flow-time-track">
        <div className="flow-time-label">
          <span>{time === null ? "Activity timeline" : flowDate.format(time)}</span>
          <span>{time === null ? `${marks.length} events` : `${index + 1} / ${marks.length}`}</span>
        </div>
        <div className="flow-track-area" style={{ "--flow-progress": `${progress}%` } as CSSProperties}>
          <div className="flow-time-marks" aria-hidden="true">
            {bins.map((bin) => <i key={bin.at} data-tone={bin.tone} style={{ height: Math.min(18, 4 + bin.count * 2) }} />)}
          </div>
          <input aria-label="Timeline position" type="range" min={0} max={Math.max(1, marks.length - 1)}
            value={Math.max(0, index)} disabled={!playable}
            aria-valuetext={marks[index] ? flowDate.format(marks[index].at) : "No recorded activity"}
            onChange={(event) => jump(marks[Number(event.target.value)]?.at ?? null)} />
        </div>
      </div>
      <select className="flow-replay-speed" aria-label="Playback speed" value={speed}
        onChange={(event) => setSpeed(Number(event.target.value))}>
        <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
      </select>
    </section>
  );
}
