import { describe, expect, it } from "vitest";
import {
  addHistoryEntry,
  MAX_HISTORY,
  previewOf,
  type SpeechHistoryEntry,
} from "./history";

function entry(over: Partial<SpeechHistoryEntry> = {}): SpeechHistoryEntry {
  return {
    id: "s-1",
    text: "Hello there.",
    preview: "Hello there.",
    voiceId: "v-1",
    voiceName: "Dora",
    model: "kokoro-82m",
    at: 1,
    chunks: 1,
    ...over,
  };
}

describe("previewOf", () => {
  it("collapses an utterance into one readable line", () => {
    expect(previewOf("  two\n\tlines  here ")).toBe("two lines here");
  });

  it("truncates a long one without cutting mid-whitespace", () => {
    const preview = previewOf("word ".repeat(60));
    expect(preview.length).toBeLessThanOrEqual(90);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview).not.toContain("  ");
  });
});

describe("addHistoryEntry", () => {
  it("puts the newest first", () => {
    const list = addHistoryEntry(
      [entry({ id: "s-1", text: "first" })],
      entry({ id: "s-2", text: "second" }),
    );
    expect(list.map((e) => e.id)).toEqual(["s-2", "s-1"]);
  });

  it("keeps only the last ten", () => {
    let list: SpeechHistoryEntry[] = [];
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      list = addHistoryEntry(list, entry({ id: `s-${i}`, text: `t${i}` }));
    }
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].id).toBe(`s-${MAX_HISTORY + 4}`);
  });

  it("moves a repeat to the front instead of duplicating it", () => {
    const list = addHistoryEntry(
      [entry({ id: "s-1", text: "same" }), entry({ id: "s-0", text: "other" })],
      entry({ id: "s-2", text: "same" }),
    );
    expect(list.map((e) => e.id)).toEqual(["s-2", "s-0"]);
  });

  it("treats the same text in another voice as its own entry", () => {
    const list = addHistoryEntry(
      [entry({ id: "s-1", text: "same", voiceId: "v-1" })],
      entry({ id: "s-2", text: "same", voiceId: "v-2" }),
    );
    expect(list).toHaveLength(2);
  });
});
