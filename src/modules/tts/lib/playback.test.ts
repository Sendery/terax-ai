import { describe, expect, it } from "vitest";
import {
  chunksToSynthesize,
  currentAudioUrl,
  initialPlaybackState,
  isSpeaking,
  playbackProgress,
  playbackReducer,
  PREFETCH_DEPTH,
  type PlaybackEvent,
  type PlaybackState,
} from "./playback";

const CHUNKS = ["one.", "two.", "three."];

function enqueued(chunks: readonly string[] = CHUNKS): PlaybackState {
  return playbackReducer(initialPlaybackState, { type: "enqueue", chunks });
}

function reduce(
  state: PlaybackState,
  ...events: PlaybackEvent[]
): PlaybackState {
  return events.reduce(playbackReducer, state);
}

const EVENTS: PlaybackEvent[] = [
  { type: "enqueue", chunks: CHUNKS },
  { type: "synthesized", index: 0, url: "blob:0" },
  { type: "ended", index: 0 },
  { type: "error", index: 0, message: "boom" },
  { type: "stop" },
];

describe("enqueue", () => {
  it("starts synthesizing from the first chunk", () => {
    const state = enqueued();
    expect(state.phase).toBe("synthesizing");
    expect(state.cursor).toBe(0);
    expect(state.playing).toBeNull();
    expect(state.chunks).toEqual(CHUNKS);
    expect(state.error).toBeNull();
    expect(isSpeaking(state)).toBe(true);
  });

  it("goes back to idle for an empty queue", () => {
    expect(playbackReducer(enqueued(), { type: "enqueue", chunks: [] })).toEqual(
      initialPlaybackState,
    );
  });

  it("replaces a running queue and clears the previous error", () => {
    const errored = reduce(enqueued(), {
      type: "error",
      index: 0,
      message: "boom",
    });
    const next = playbackReducer(errored, {
      type: "enqueue",
      chunks: ["fresh."],
    });
    expect(next.error).toBeNull();
    expect(next.chunks).toEqual(["fresh."]);
    expect(next.phase).toBe("synthesizing");
  });
});

describe("synthesized", () => {
  it("plays the chunk the cursor waits on", () => {
    const state = reduce(enqueued(), {
      type: "synthesized",
      index: 0,
      url: "blob:0",
    });
    expect(state.phase).toBe("playing");
    expect(state.playing).toBe(0);
    expect(currentAudioUrl(state)).toBe("blob:0");
  });

  it("parks a prefetched chunk without interrupting the current one", () => {
    const state = reduce(
      enqueued(),
      { type: "synthesized", index: 0, url: "blob:0" },
      { type: "synthesized", index: 1, url: "blob:1" },
    );
    expect(state.playing).toBe(0);
    expect(state.ready).toEqual({ 0: "blob:0", 1: "blob:1" });
  });

  it("ignores a result for a chunk already behind the cursor", () => {
    const state = reduce(
      enqueued(),
      { type: "synthesized", index: 0, url: "blob:0" },
      { type: "ended", index: 0 },
    );
    expect(
      playbackReducer(state, { type: "synthesized", index: 0, url: "late" }),
    ).toBe(state);
  });

  it("ignores a result out of range and one arriving after a stop", () => {
    const state = enqueued();
    expect(
      playbackReducer(state, { type: "synthesized", index: 9, url: "x" }),
    ).toBe(state);
    const stopped = playbackReducer(state, { type: "stop" });
    expect(
      playbackReducer(stopped, { type: "synthesized", index: 0, url: "x" }),
    ).toBe(stopped);
  });
});

describe("ended", () => {
  it("plays the next chunk straight away when it is ready", () => {
    const state = reduce(
      enqueued(),
      { type: "synthesized", index: 0, url: "blob:0" },
      { type: "synthesized", index: 1, url: "blob:1" },
      { type: "ended", index: 0 },
    );
    expect(state.phase).toBe("playing");
    expect(state.cursor).toBe(1);
    expect(state.playing).toBe(1);
    expect(state.ready).toEqual({ 1: "blob:1" });
  });

  it("waits on synthesis when the next chunk is not ready", () => {
    const state = reduce(
      enqueued(),
      { type: "synthesized", index: 0, url: "blob:0" },
      { type: "ended", index: 0 },
    );
    expect(state.phase).toBe("synthesizing");
    expect(state.playing).toBeNull();
    expect(state.cursor).toBe(1);
  });

  it("returns to idle after the last chunk", () => {
    let state = enqueued(["only."]);
    state = reduce(
      state,
      { type: "synthesized", index: 0, url: "blob:0" },
      { type: "ended", index: 0 },
    );
    expect(state.phase).toBe("idle");
    expect(isSpeaking(state)).toBe(false);
    expect(state.ready).toEqual({});
    expect(state.cursor).toBe(1);
  });

  it("ignores an ended event for a chunk that is not the one playing", () => {
    const state = reduce(enqueued(), {
      type: "synthesized",
      index: 0,
      url: "blob:0",
    });
    expect(playbackReducer(state, { type: "ended", index: 2 })).toBe(state);
    const stopped = playbackReducer(state, { type: "stop" });
    expect(playbackReducer(stopped, { type: "ended", index: 0 })).toBe(stopped);
  });
});

describe("error and stop", () => {
  it("stops the whole utterance and keeps the message", () => {
    const state = reduce(
      enqueued(),
      { type: "synthesized", index: 0, url: "blob:0" },
      { type: "error", index: 1, message: "engine died" },
    );
    expect(state.phase).toBe("stopped");
    expect(state.playing).toBeNull();
    expect(state.ready).toEqual({});
    expect(state.error).toBe("engine died");
    expect(isSpeaking(state)).toBe(false);
  });

  it("keeps an earlier error visible through a stop", () => {
    const state = reduce(
      enqueued(),
      { type: "error", index: 0, message: "boom" },
      { type: "stop" },
    );
    expect(state.error).toBe("boom");
  });

  it("drops every ready url on stop but remembers where it was", () => {
    const state = reduce(
      enqueued(),
      { type: "synthesized", index: 0, url: "blob:0" },
      { type: "ended", index: 0 },
      { type: "synthesized", index: 1, url: "blob:1" },
      { type: "stop" },
    );
    expect(state.phase).toBe("stopped");
    expect(state.cursor).toBe(1);
    expect(state.ready).toEqual({});
    expect(currentAudioUrl(state)).toBeNull();
  });

  it("is idempotent", () => {
    const stopped = playbackReducer(enqueued(), { type: "stop" });
    expect(playbackReducer(stopped, { type: "stop" })).toBe(stopped);
  });
});

describe("every event in every phase", () => {
  it("never leaves an unknown phase or a playing index out of range", () => {
    const phases: PlaybackState[] = [
      initialPlaybackState,
      enqueued(),
      reduce(enqueued(), { type: "synthesized", index: 0, url: "blob:0" }),
      playbackReducer(enqueued(), { type: "stop" }),
    ];
    for (const state of phases) {
      for (const event of EVENTS) {
        const next = playbackReducer(state, event);
        expect(["idle", "synthesizing", "playing", "stopped"]).toContain(
          next.phase,
        );
        if (next.playing !== null) {
          expect(next.playing).toBeGreaterThanOrEqual(0);
          expect(next.playing).toBeLessThan(next.chunks.length);
          expect(next.ready[next.playing]).toBeDefined();
        }
        if (next.phase === "playing") expect(next.playing).not.toBeNull();
      }
    }
  });
});

describe("chunksToSynthesize", () => {
  it("asks for the current chunk plus the prefetch depth", () => {
    expect(PREFETCH_DEPTH).toBe(1);
    expect(chunksToSynthesize(enqueued(), new Set())).toEqual([0, 1]);
  });

  it("skips what is ready and what is already in flight", () => {
    const state = reduce(enqueued(), {
      type: "synthesized",
      index: 0,
      url: "blob:0",
    });
    expect(chunksToSynthesize(state, new Set())).toEqual([1]);
    expect(chunksToSynthesize(state, new Set([1]))).toEqual([]);
  });

  it("never reads past the end of the queue", () => {
    const state = reduce(
      enqueued(["a.", "b."]),
      { type: "synthesized", index: 0, url: "blob:0" },
      { type: "synthesized", index: 1, url: "blob:1" },
      { type: "ended", index: 0 },
    );
    expect(chunksToSynthesize(state, new Set())).toEqual([]);
  });

  it("asks for nothing while idle or stopped", () => {
    expect(chunksToSynthesize(initialPlaybackState, new Set())).toEqual([]);
    expect(
      chunksToSynthesize(
        playbackReducer(enqueued(), { type: "stop" }),
        new Set(),
      ),
    ).toEqual([]);
  });
});

describe("playbackProgress", () => {
  it("reports the chunk in flight out of the total", () => {
    expect(playbackProgress(initialPlaybackState)).toEqual({
      index: 0,
      total: 0,
    });
    expect(playbackProgress(enqueued())).toEqual({ index: 0, total: 3 });
    const second = reduce(
      enqueued(),
      { type: "synthesized", index: 0, url: "blob:0" },
      { type: "ended", index: 0 },
    );
    expect(playbackProgress(second)).toEqual({ index: 1, total: 3 });
  });
});
