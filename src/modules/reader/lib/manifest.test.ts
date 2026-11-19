import { describe, expect, it } from "vitest";
import type { VoiceProfile } from "@/modules/tts/lib/voices";
import { parseDocument } from "./document";
import {
  adjacentCut,
  allCuts,
  buildManifest,
  clampSpeed,
  defaultReaderState,
  guessLanguage,
  labelAt,
  parseManifest,
  pausesBySegment,
  stepSpeed,
  stopsBySegment,
  toggleCut,
  userBreaks,
  voiceKeyOf,
} from "./manifest";
import { buildTimeline } from "./timing";

const voice: VoiceProfile = {
  id: "v-1",
  name: "Dora",
  model: "kokoro-82m",
  language: "es-ES",
  voice: "ef_dora",
  sampleId: null,
  params: { speed: 1 },
  style: { text: "", tags: [] } as unknown as VoiceProfile["style"],
  createdAt: 0,
};

describe("speed", () => {
  it("clamps and steps through the supported rates", () => {
    expect(clampSpeed(9)).toBe(2.5);
    expect(clampSpeed(0.1)).toBe(0.75);
    expect(clampSpeed(Number.NaN)).toBe(1);
    expect(stepSpeed(1, 1)).toBe(1.25);
    expect(stepSpeed(1, -1)).toBe(0.75);
    expect(stepSpeed(2.5, 1)).toBe(2.5);
    expect(stepSpeed(0.75, -1)).toBe(0.75);
  });
});

describe("voiceKeyOf", () => {
  it("changes with what changes the audio", () => {
    const base = voiceKeyOf(voice);
    expect(voiceKeyOf({ ...voice, name: "Other" })).toBe(base);
    expect(voiceKeyOf({ ...voice, voice: "em_alex" })).not.toBe(base);
    expect(voiceKeyOf({ ...voice, params: { speed: 1.2 } })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{14}$/);
  });
});

describe("cuts", () => {
  const doc = parseDocument(
    "Uno dos tres cuatro. Cinco seis [pause: 1s] siete ocho.",
  );

  it("toggles user cuts and keeps text cuts out of the toggle", () => {
    let cuts = toggleCut([], "bookmark", 2, "here");
    expect(cuts).toHaveLength(1);
    cuts = toggleCut(cuts, "bookmark", 2, "here");
    expect(cuts).toHaveLength(0);
    cuts = toggleCut(cuts, "pause", 3, "p", 2000);
    cuts = toggleCut(cuts, "stop", 3, "s");
    expect(cuts.map((c) => c.kind)).toEqual(["stop"]);
    expect(userBreaks(cuts)).toEqual([3]);
  });

  it("merges text cuts with user cuts in reading order", () => {
    const user = toggleCut([], "bookmark", 1, "b");
    const merged = allCuts(doc, user);
    expect(merged.map((c) => [c.kind, c.source])).toEqual([
      ["bookmark", "user"],
      ["pause", "text"],
    ]);
  });

  it("finds the next and previous cut", () => {
    const cuts = allCuts(doc, toggleCut([], "bookmark", 1, "b"));
    expect(adjacentCut(cuts, 1, 1)?.kind).toBe("pause");
    expect(adjacentCut(cuts, 1, -1)).toBeNull();
    expect(adjacentCut(cuts, 7, -1)?.kind).toBe("pause");
  });

  it("turns cuts into pauses and stops between segments", () => {
    const stopDoc = parseDocument(
      "Uno dos tres cuatro. Cinco seis siete ocho.",
      [6],
    );
    const cuts = toggleCut(toggleCut([], "stop", 6, "s"), "bookmark", 4, "b");
    expect([...stopsBySegment(stopDoc, cuts, false)]).toEqual([
      stopDoc.words[6].segment,
    ]);
    expect(stopsBySegment(stopDoc, cuts, true).size).toBe(2);
    const pauses = pausesBySegment(doc, allCuts(doc, []));
    expect([...pauses.values()]).toEqual([1000]);
  });

  it("labels a bookmark with the words that follow it", () => {
    expect(labelAt(doc, 0, 3)).toBe("Uno dos tres");
  });
});

describe("manifest round trip", () => {
  const doc = parseDocument(
    "Primera frase del texto. Segunda frase del texto.",
  );

  it("writes the spec shape and reads back the user state", () => {
    const state = {
      ...defaultReaderState("Doc", "/tmp/doc.md"),
      voiceId: "v-1",
      speed: 1.25,
      lastWordIndex: 5,
      lastPositionMs: 2400,
      status: "playing" as const,
      cutPoints: toggleCut([], "bookmark", 4, "Segunda"),
      origin: { key: "k7f3a9c1", label: "zsh" },
    };
    const durations = new Map([[0, 2000]]);
    const json = buildManifest({
      id: "abcdefabcdef",
      doc,
      state,
      language: "es-ES",
      voiceKey: voiceKeyOf(voice),
      durations,
      timeline: buildTimeline(doc, durations),
      now: new Date(0),
    });
    expect(json.playback_state).toEqual({
      status: "paused",
      last_position_ms: 2400,
      last_word_index: 5,
      speed: 1.25,
    });
    expect(json.segments).toHaveLength(1);
    expect(json.segments[0].chunk_file).toMatch(
      /^chunks\/[0-9a-f]{14}\/[0-9a-f]{14}\.wav$/,
    );
    expect(json.segments[0].words?.[0]).toMatchObject({
      index: 0,
      text: "Primera",
      char_start: 0,
    });
    expect(json.cut_points[0]).toMatchObject({
      kind: "bookmark",
      word_index: 4,
      source: "user",
    });

    const back = parseManifest(
      JSON.stringify(json),
      doc.words.length,
      "x",
      null,
    );
    expect(back).toMatchObject({
      title: "Doc",
      sourcePath: "/tmp/doc.md",
      voiceId: "v-1",
      speed: 1.25,
      lastWordIndex: 5,
      status: "paused",
      origin: { key: "k7f3a9c1", label: "zsh" },
    });
    expect(back.cutPoints).toHaveLength(1);
  });

  it("drops malformed and out-of-range fields", () => {
    const raw = JSON.stringify({
      title: 5,
      origin: { key: "../tab", label: "x" },
      playback_state: { speed: 40, last_word_index: 9999, status: "weird" },
      cut_points: [
        { kind: "nope", word_index: 1 },
        { kind: "pause", word_index: 2, pause_after_ms: 999_999, id: "a" },
        { kind: "bookmark", word_index: 3, id: "a" },
        { kind: "pause", word_index: 1, source: "text", id: "t" },
      ],
    });
    const state = parseManifest(raw, doc.words.length, "Fallback", null);
    expect(state.title).toBe("Fallback");
    expect(state.speed).toBe(2.5);
    expect(state.lastWordIndex).toBe(0);
    expect(state.status).toBe("idle");
    expect(state.origin).toBeNull();
    expect(state.cutPoints).toEqual([
      expect.objectContaining({ kind: "pause", wordIndex: 2, pauseMs: 60_000 }),
    ]);
    expect(parseManifest("{nope", 3, "F", null).title).toBe("F");
  });
});

describe("guessLanguage", () => {
  it("tells Spanish from English", () => {
    expect(
      guessLanguage(
        parseDocument(
          "El perro de la casa es muy grande y también come mucho.",
        ),
      ),
    ).toBe("es-ES");
    expect(
      guessLanguage(
        parseDocument("The dog in the house is big and it eats a lot of food."),
      ),
    ).toBe("en-US");
    expect(guessLanguage(parseDocument("xyz"))).toBeNull();
  });
});
