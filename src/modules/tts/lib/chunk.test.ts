import { describe, expect, it } from "vitest";
import {
  collapseWhitespace,
  DEFAULT_MAX_TOTAL,
  splitForSpeech,
  splitSentences,
  stripTerminalNoise,
} from "./chunk";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe("stripTerminalNoise", () => {
  it("removes SGR colour runs", () => {
    expect(stripTerminalNoise(`${ESC}[31mred${ESC}[0m text`)).toBe("red text");
  });

  it("removes OSC 7 and OSC 133 sequences with either terminator", () => {
    expect(
      stripTerminalNoise(`${ESC}]7;file://host/tmp${BEL}prompt$ ls`),
    ).toBe("prompt$ ls");
    expect(stripTerminalNoise(`${ESC}]133;A${ESC}\\done`)).toBe("done");
    expect(stripTerminalNoise(`${ESC}]0;a title${BEL}body`)).toBe("body");
  });

  it("removes cursor moves, single-char escapes and stray control bytes", () => {
    expect(stripTerminalNoise(`${ESC}[2J${ESC}[1;1Hclean`)).toBe("clean");
    expect(stripTerminalNoise(`${ESC}=alt${ESC}>`)).toBe("alt");
    const NUL = String.fromCharCode(0x00);
    expect(stripTerminalNoise(`bell${BEL} and${NUL} null`)).toBe(
      "bell and null",
    );
  });

  it("keeps newlines and tabs and normalizes carriage returns", () => {
    expect(stripTerminalNoise("a\r\nb\rc\td")).toBe("a\nb\nc\td");
  });
});

describe("collapseWhitespace", () => {
  it("collapses runs of spaces and blank lines", () => {
    expect(collapseWhitespace("  a \t  b \n\n\n c  ")).toBe("a b\nc");
  });
});

describe("splitSentences", () => {
  it("splits on terminal punctuation followed by space", () => {
    expect(splitSentences("One. Two! Three?")).toEqual([
      "One.",
      "Two!",
      "Three?",
    ]);
  });

  it("splits on colons, semicolons and newlines", () => {
    expect(splitSentences("Note: this;\nand that")).toEqual([
      "Note:",
      "this;",
      "and that",
    ]);
  });

  it("keeps abbreviations, initials, decimals and file names together", () => {
    expect(splitSentences("Use e.g. this one. Done")).toEqual([
      "Use e.g. this one.",
      "Done",
    ]);
    expect(splitSentences("El Sr. García llegó. Bien")).toEqual([
      "El Sr. García llegó.",
      "Bien",
    ]);
    expect(splitSentences("Pi is 3.14 exactly")).toEqual(["Pi is 3.14 exactly"]);
    expect(splitSentences("Open main.ts now")).toEqual(["Open main.ts now"]);
    expect(splitSentences("Ask J. Smith about it")).toEqual([
      "Ask J. Smith about it",
    ]);
    expect(splitSentences("See http://127.0.0.1:8080/x now")).toEqual([
      "See http://127.0.0.1:8080/x now",
    ]);
    expect(splitSentences("At 10:30 sharp")).toEqual(["At 10:30 sharp"]);
  });

  it("keeps ellipses and closing quotes with their sentence", () => {
    expect(splitSentences('He said "hi." Then left.')).toEqual([
      'He said "hi."',
      "Then left.",
    ]);
    expect(splitSentences("Wait... then go. Now")).toEqual([
      "Wait...",
      "then go.",
      "Now",
    ]);
  });
});

describe("splitForSpeech", () => {
  it("returns nothing for text that is only terminal noise", () => {
    expect(splitForSpeech(`${ESC}[0m  ${ESC}]7;x${BEL}`)).toEqual({
      chunks: [],
      truncated: false,
    });
    expect(splitForSpeech("")).toEqual({ chunks: [], truncated: false });
  });

  it("merges tiny fragments into the sentence before them", () => {
    const { chunks } = splitForSpeech("Ok. Sure. Fine.");
    expect(chunks).toEqual(["Ok. Sure. Fine."]);
  });

  it("keeps chunks under the requested size", () => {
    const sentence = `${"word ".repeat(30).trim()}.`;
    const { chunks } = splitForSpeech(sentence.repeat(6), { maxChars: 120 });
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
  });

  it("hard wraps an over-long sentence at word boundaries", () => {
    const long = `${"alpha ".repeat(40).trim()} end`;
    const { chunks } = splitForSpeech(long, { maxChars: 60 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(60);
      expect(chunk.startsWith(" ")).toBe(false);
      expect(chunk.endsWith(" ")).toBe(false);
    }
    expect(chunks.join(" ")).toBe(long);
  });

  it("splits a single word longer than the chunk size", () => {
    const { chunks } = splitForSpeech("x".repeat(140), { maxChars: 50 });
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 40]);
  });

  it("caps the total text and reports the truncation", () => {
    const result = splitForSpeech("palabra ".repeat(2000), { maxTotal: 200 });
    expect(result.truncated).toBe(true);
    const total = result.chunks.join(" ").length;
    expect(total).toBeLessThanOrEqual(200);
  });

  it("does not report truncation below the cap", () => {
    expect(splitForSpeech("Short sentence.").truncated).toBe(false);
    expect(DEFAULT_MAX_TOTAL).toBe(8192);
  });

  it("strips noise before chunking so escapes never reach the engine", () => {
    const { chunks } = splitForSpeech(
      `${ESC}[32m$ ls -la${ESC}[0m\n${ESC}]133;C${BEL}total 4`,
    );
    expect(chunks.join(" ")).toBe("$ ls -la total 4");
  });
});
