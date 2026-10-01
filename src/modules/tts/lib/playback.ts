export type PlaybackPhase =
  | "idle"
  | "synthesizing"
  | "playing"
  | "paused"
  | "stopped";

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
  | { type: "pause" }
  | { type: "resume" }
  /** Jump to a chunk; out-of-range indexes are clamped by `seekTarget`. */
  | { type: "seek"; index: number }
  | { type: "stop" };

/** Synthesize chunk n+1 while chunk n plays: one round trip of headroom
 *  without paying for the whole utterance up front. */
export const PREFETCH_DEPTH = 1;

/**
 * How many played chunks keep their audio so stepping back is instant. An
 * utterance is capped at 8192 characters, so the whole queue is at most ~21
 * chunks; holding the last few is a few megabytes, and holding all of them
 * would not be.
 */
export const RETAINED_BEHIND = 6;

export const initialPlaybackState: PlaybackState = {
  phase: "idle",
  chunks: [],
  cursor: 0,
  playing: null,
  ready: {},
  error: null,
};

function isLive(phase: PlaybackPhase): boolean {
  return (
    phase === "synthesizing" || phase === "playing" || phase === "paused"
  );
}

/** Drops what has fallen out of the step-back window, keeping everything the
 *  queue may still need to play forwards. */
function trimBehind(
  ready: Readonly<Record<number, string>>,
  cursor: number,
): Record<number, string> {
  const oldest = cursor - RETAINED_BEHIND;
  const next: Record<number, string> = {};
  for (const [key, url] of Object.entries(ready)) {
    if (Number(key) < oldest) continue;
    next[Number(key)] = url;
  }
  return next;
}

/**
 * How far into a chunk a back step stops meaning "the previous chunk" and
 * starts meaning "this one again". Chunks run up to ~25 seconds, so without
 * this a back step from the middle of one skips past what is being listened to.
 */
export const RESTART_AFTER_SECONDS = 3;

/** The chunk a step of `delta` lands on, clamped to the queue. */
export function seekTarget(
  state: PlaybackState,
  delta: number,
  elapsedSeconds = 0,
): number | null {
  if (!isLive(state.phase) || state.chunks.length === 0) return null;
  const from = state.playing ?? state.cursor;
  if (delta < 0 && elapsedSeconds > RESTART_AFTER_SECONDS) return from;
  return Math.min(state.chunks.length - 1, Math.max(0, from + delta));
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
      if (event.index < 0 || event.index >= state.chunks.length) return state;
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
      const ready = trimBehind(state.ready, cursor);
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
    case "pause": {
      // Only sound can be paused; a chunk still being synthesized keeps going,
      // and its audio waits on the element instead of starting.
      if (state.phase !== "playing") return state;
      return { ...state, phase: "paused" };
    }
    case "resume": {
      if (state.phase !== "paused") return state;
      // Nothing on the element means the chunk was never ready: go back to
      // waiting for it rather than claiming to play silence.
      const phase = state.playing === null ? "synthesizing" : "playing";
      return { ...state, phase };
    }
    case "seek": {
      if (!isLive(state.phase)) return state;
      const index = event.index;
      if (index < 0 || index >= state.chunks.length) return state;
      const ready = trimBehind(state.ready, index);
      if (ready[index] !== undefined) {
        return { ...state, phase: "playing", cursor: index, playing: index, ready };
      }
      return {
        ...state,
        phase: "synthesizing",
        cursor: index,
        playing: null,
        ready,
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

export function isPaused(state: PlaybackState): boolean {
  return state.phase === "paused";
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
