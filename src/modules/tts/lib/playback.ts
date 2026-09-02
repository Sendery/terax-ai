export type PlaybackPhase = "idle" | "synthesizing" | "playing" | "stopped";

export type PlaybackState = {
  phase: PlaybackPhase;
  chunks: readonly string[];
  /** Chunk waiting to play, or being played right now. */
  cursor: number;
  /** Chunk whose audio is on the element, null while nothing sounds. */
  playing: number | null;
  /** Object URLs of chunks already synthesized, keyed by chunk index. */
  ready: Readonly<Record<number, string>>;
  error: string | null;
};

export type PlaybackEvent =
  | { type: "enqueue"; chunks: readonly string[] }
  | { type: "synthesized"; index: number; url: string }
  | { type: "ended"; index: number }
  | { type: "error"; index: number; message: string }
  | { type: "stop" };

/** Synthesize chunk n+1 while chunk n plays: one round trip of headroom
 *  without paying for the whole utterance up front. */
export const PREFETCH_DEPTH = 1;

export const initialPlaybackState: PlaybackState = {
  phase: "idle",
  chunks: [],
  cursor: 0,
  playing: null,
  ready: {},
  error: null,
};

function isLive(phase: PlaybackPhase): boolean {
  return phase === "synthesizing" || phase === "playing";
}

function withoutIndex(
  ready: Readonly<Record<number, string>>,
  index: number,
): Record<number, string> {
  const next: Record<number, string> = {};
  for (const [key, url] of Object.entries(ready)) {
    if (Number(key) !== index) next[Number(key)] = url;
  }
  return next;
}

export function playbackReducer(
  state: PlaybackState,
  event: PlaybackEvent,
): PlaybackState {
  switch (event.type) {
    case "enqueue": {
      const chunks = [...event.chunks];
      if (chunks.length === 0) return { ...initialPlaybackState };
      return {
        phase: "synthesizing",
        chunks,
        cursor: 0,
        playing: null,
        ready: {},
        error: null,
      };
    }
    case "synthesized": {
      if (!isLive(state.phase)) return state;
      if (event.index < state.cursor || event.index >= state.chunks.length) {
        return state;
      }
      const ready = { ...state.ready, [event.index]: event.url };
      if (state.playing === null && event.index === state.cursor) {
        return { ...state, phase: "playing", playing: state.cursor, ready };
      }
      return { ...state, ready };
    }
    case "ended": {
      if (!isLive(state.phase)) return state;
      if (state.playing !== event.index) return state;
      const cursor = event.index + 1;
      const ready = withoutIndex(state.ready, event.index);
      if (cursor >= state.chunks.length) {
        return { ...initialPlaybackState, chunks: state.chunks, cursor };
      }
      if (ready[cursor] !== undefined) {
        return { ...state, phase: "playing", cursor, playing: cursor, ready };
      }
      return { ...state, phase: "synthesizing", cursor, playing: null, ready };
    }
    case "error": {
      if (!isLive(state.phase)) return state;
      return {
        ...state,
        phase: "stopped",
        playing: null,
        ready: {},
        error: event.message,
      };
    }
    case "stop": {
      if (state.phase === "stopped") return state;
      return { ...state, phase: "stopped", playing: null, ready: {} };
    }
  }
}

/**
 * Chunks whose synthesis should be running now: the one the queue waits on
 * plus `PREFETCH_DEPTH` ahead, minus what is ready or already in flight.
 */
export function chunksToSynthesize(
  state: PlaybackState,
  inFlight: ReadonlySet<number>,
): number[] {
  if (!isLive(state.phase)) return [];
  const out: number[] = [];
  const last = Math.min(
    state.chunks.length - 1,
    state.cursor + PREFETCH_DEPTH,
  );
  for (let index = state.cursor; index <= last; index++) {
    if (state.ready[index] !== undefined) continue;
    if (inFlight.has(index)) continue;
    out.push(index);
  }
  return out;
}

/** Audio the element should be playing, if it is not already. */
export function currentAudioUrl(state: PlaybackState): string | null {
  if (state.phase !== "playing" || state.playing === null) return null;
  return state.ready[state.playing] ?? null;
}

export function isSpeaking(state: PlaybackState): boolean {
  return isLive(state.phase);
}

export function playbackProgress(state: PlaybackState): {
  index: number;
  total: number;
} {
  return {
    index: Math.min(state.cursor, Math.max(0, state.chunks.length - 1)),
    total: state.chunks.length,
  };
}
