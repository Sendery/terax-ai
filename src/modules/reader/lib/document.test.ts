import { describe, expect, it } from "vitest";
import {
  hashKey,
  isSilentSegment,
  MAX_SEGMENT_CHARS,
  nextBlockWord,
  parseDocument,
  visibleText,
} from "./document";

describe("visibleText", () => {
  it("keeps link text and maps it back to the source", () => {
    const raw = "see [the docs](https://x.dev) now";
    const v = visibleText(raw, 10);
    expect(v.text).toBe("see the docs now");
    expect(v.map[4]).toBe(10 + raw.indexOf("the"));
  });

  it("drops emphasis and code markers but keeps snake_case and lone symbols", () => {
    expect(
      visibleText("**bold** and _it_ `code` snake_case 2 * 3 ~/x", 0).text,
    ).toBe("bold and it code snake_case 2 * 3 ~/x");
  });
});

describe("parseDocument", () => {
  it("splits paragraphs into sentence segments with source offsets", () => {
    const source =
      "Hola mundo. Esto es una prueba larga.\n\nSegundo párrafo aquí.";
    const doc = parseDocument(source);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
    expect(doc.segments.map((s) => s.text)).toEqual([
      "Hola mundo.",
      "Esto es una prueba larga.",
      "Segundo párrafo aquí.",
    ]);
    const word = doc.words.find((w) => w.text === "prueba");
    expect(word && source.slice(word.charStart, word.charEnd)).toBe("prueba");
  });

  it("separates sentences that are long enough on their own", () => {
    const doc = parseDocument(
      "The first sentence is here. The second one follows it.",
    );
    expect(doc.segments).toHaveLength(2);
    expect(doc.words[doc.segments[1].wordStart].text).toBe("The");
  });

  it("does not end a sentence at an abbreviation or an initial", () => {
    const doc = parseDocument(
      "Habló con el Dr. Pérez y con J. Smith sobre el tema principal.",
    );
    expect(doc.segments).toHaveLength(1);
  });

  it("reads headings, list items and quotes as their own blocks", () => {
    const doc = parseDocument(
      "# Title\n\n- one item here\n- two items there\n\n> quoted line",
    );
    expect(doc.blocks.map((b) => [b.kind, b.level])).toEqual([
      ["heading", 1],
      ["list", 0],
      ["list", 0],
      ["quote", 0],
    ]);
    expect(doc.segments.map((s) => s.text)).toEqual([
      "Title",
      "one item here",
      "two items there",
      "quoted line",
    ]);
  });

  it("turns each table row into one segment with commas between cells", () => {
    const doc = parseDocument(
      "| Name | Role |\n| --- | --- |\n| Ana | Lead dev |",
    );
    expect(doc.blocks.map((b) => b.kind)).toEqual(["table-row", "table-row"]);
    expect(doc.blocks[0].header).toBe(true);
    expect(doc.segments.map((s) => s.text)).toEqual([
      "Name, Role",
      "Ana, Lead dev",
    ]);
    expect(doc.words.find((w) => w.text === "dev")?.cell).toBe(1);
  });

  it("shows code blocks without speaking them", () => {
    const doc = parseDocument(
      "Before it.\n\n```ts\nconst x = 1;\n```\n\nAfter it.",
    );
    const code = doc.blocks.find((b) => b.kind === "code");
    expect(code?.code).toBe("const x = 1;");
    expect(code?.wordEnd).toBe(code?.wordStart);
    expect(doc.segments.map((s) => s.text)).toEqual([
      "Before it.",
      "After it.",
    ]);
  });

  it("keeps bare URLs on screen but out of the speech", () => {
    const doc = parseDocument("Open https://example.com/path to continue.");
    expect(doc.words.map((w) => w.text)).toContain("https://example.com/path");
    expect(doc.segments[0].text).toBe("Open to continue.");
  });

  it("extracts pause and stop tags as cuts that break segments", () => {
    const doc = parseDocument(
      "Uno dos tres [pause: 2s] cuatro cinco seis. Siete [stop] ocho nueve diez.",
    );
    expect(doc.words.map((w) => w.text)).not.toContain("[pause:");
    const cuatro = doc.words.findIndex((w) => w.text === "cuatro");
    const ocho = doc.words.findIndex((w) => w.text === "ocho");
    expect(doc.inlineCuts).toEqual([
      { wordIndex: cuatro, kind: "pause", pauseMs: 2000 },
      { wordIndex: ocho, kind: "stop", pauseMs: 0 },
    ]);
    expect(doc.segments.map((s) => s.wordStart)).toContain(cuatro);
    expect(doc.segments.map((s) => s.wordStart)).toContain(ocho);
  });

  it("accepts millisecond pauses and Spanish tag names", () => {
    const doc = parseDocument(
      "Antes de la pausa [pausa: 800ms] después de ella.",
    );
    expect(doc.inlineCuts[0]).toMatchObject({ kind: "pause", pauseMs: 800 });
  });

  it("breaks a segment where a user cut sits", () => {
    const plain = parseDocument("one two three four five six seven eight.");
    expect(plain.segments).toHaveLength(1);
    const cut = parseDocument("one two three four five six seven eight.", [4]);
    expect(cut.segments.map((s) => s.wordStart)).toEqual([0, 4]);
  });

  it("wraps sentences longer than the segment cap", () => {
    const long = `${"palabra ".repeat(120).trim()}.`;
    const doc = parseDocument(long);
    expect(doc.segments.length).toBeGreaterThan(1);
    for (const s of doc.segments)
      expect(s.text.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS);
  });

  it("merges a tiny sentence into the next one", () => {
    const doc = parseDocument("Sí. Esto continúa con una frase normal.");
    expect(doc.segments).toHaveLength(1);
  });

  it("assigns every word a segment", () => {
    const doc = parseDocument("# T\n\nA b c. D e f.\n\n| x | y |\n\n- item");
    expect(doc.words.every((w) => w.segment >= 0)).toBe(true);
  });

  it("gives identical text identical keys", () => {
    expect(hashKey("abc")).toBe(hashKey("abc"));
    expect(hashKey("abc")).not.toBe(hashKey("abd"));
    expect(hashKey("abc")).toMatch(/^[0-9a-f]{14}$/);
  });

  it("flags segments with nothing to say", () => {
    const doc = parseDocument("https://only.example.com");
    expect(isSilentSegment(doc.segments[0])).toBe(true);
  });
});

describe("nextBlockWord", () => {
  it("moves between blocks and back to the start of the current one", () => {
    const doc = parseDocument("one two.\n\nthree four.\n\nfive six.");
    expect(nextBlockWord(doc, 0, 1)).toBe(2);
    expect(nextBlockWord(doc, 3, -1)).toBe(2);
    expect(nextBlockWord(doc, 2, -1)).toBe(0);
    expect(nextBlockWord(doc, 5, 1)).toBeNull();
  });
});
