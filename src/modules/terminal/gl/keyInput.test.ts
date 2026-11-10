import {
  encodeKey,
  encodePaste,
  gridFor,
  type KeyInput,
  wheelRows,
} from "@/modules/terminal/gl/keyInput";
import { describe, expect, it } from "vitest";

function key(k: string, mods: Partial<KeyInput> = {}): KeyInput {
  return {
    key: k,
    code: "",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    ...mods,
  };
}

describe("encodeKey", () => {
  it("leaves printable text to the textarea", () => {
    expect(encodeKey(key("a"))).toBeNull();
    expect(encodeKey(key("A", { shiftKey: true }))).toBeNull();
    expect(encodeKey(key(" "))).toBeNull();
    expect(encodeKey(key("é"))).toBeNull();
  });

  it("ignores composition, dead keys and Cmd chords", () => {
    expect(encodeKey(key("Enter", { isComposing: true }))).toBeNull();
    expect(encodeKey(key("Process"))).toBeNull();
    expect(encodeKey(key("Dead"))).toBeNull();
    expect(encodeKey(key("v", { metaKey: true }))).toBeNull();
    expect(encodeKey(key("ArrowUp", { metaKey: true }))).toBeNull();
  });

  it("encodes editing keys", () => {
    expect(encodeKey(key("Enter"))).toBe("\r");
    expect(encodeKey(key("Backspace"))).toBe("\x7f");
    expect(encodeKey(key("Backspace", { ctrlKey: true }))).toBe("\x08");
    expect(encodeKey(key("Tab"))).toBe("\t");
    expect(encodeKey(key("Tab", { shiftKey: true }))).toBe("\x1b[Z");
    expect(encodeKey(key("Escape"))).toBe("\x1b");
    expect(encodeKey(key("Delete"))).toBe("\x1b[3~");
    expect(encodeKey(key("Insert"))).toBe("\x1b[2~");
  });

  it("encodes navigation keys with xterm modifier parameters", () => {
    expect(encodeKey(key("ArrowUp"))).toBe("\x1b[A");
    expect(encodeKey(key("ArrowDown"))).toBe("\x1b[B");
    expect(encodeKey(key("ArrowRight"))).toBe("\x1b[C");
    expect(encodeKey(key("ArrowLeft"))).toBe("\x1b[D");
    expect(encodeKey(key("Home"))).toBe("\x1b[H");
    expect(encodeKey(key("End"))).toBe("\x1b[F");
    expect(encodeKey(key("PageUp"))).toBe("\x1b[5~");
    expect(encodeKey(key("PageDown"))).toBe("\x1b[6~");
    expect(encodeKey(key("ArrowLeft", { ctrlKey: true }))).toBe("\x1b[1;5D");
    expect(encodeKey(key("ArrowRight", { altKey: true }))).toBe("\x1b[1;3C");
    expect(encodeKey(key("ArrowUp", { shiftKey: true }))).toBe("\x1b[1;2A");
    expect(encodeKey(key("PageUp", { shiftKey: true }))).toBe("\x1b[5;2~");
  });

  it("encodes Ctrl with letters and the C0 punctuation", () => {
    expect(encodeKey(key("c", { ctrlKey: true }))).toBe("\x03");
    expect(encodeKey(key("C", { ctrlKey: true, shiftKey: true }))).toBe("\x03");
    expect(encodeKey(key("a", { ctrlKey: true }))).toBe("\x01");
    expect(encodeKey(key("z", { ctrlKey: true }))).toBe("\x1a");
    expect(encodeKey(key(" ", { ctrlKey: true }))).toBe("\x00");
    expect(encodeKey(key("[", { ctrlKey: true }))).toBe("\x1b");
    expect(encodeKey(key("\\", { ctrlKey: true }))).toBe("\x1c");
    expect(encodeKey(key("]", { ctrlKey: true }))).toBe("\x1d");
    expect(encodeKey(key("_", { ctrlKey: true }))).toBe("\x1f");
    expect(encodeKey(key("1", { ctrlKey: true }))).toBeNull();
    expect(encodeKey(key("Control", { ctrlKey: true }))).toBeNull();
  });

  it("prefixes Alt with ESC, using the physical key when Option composed", () => {
    expect(encodeKey(key("b", { altKey: true, code: "KeyB" }))).toBe("\x1bb");
    expect(encodeKey(key("ƒ", { altKey: true, code: "KeyF" }))).toBe("\x1bf");
    expect(
      encodeKey(key("ƒ", { altKey: true, shiftKey: true, code: "KeyF" })),
    ).toBe("\x1bF");
    expect(encodeKey(key("¡", { altKey: true, code: "Digit1" }))).toBe("\x1b1");
    expect(encodeKey(key("Enter", { altKey: true }))).toBe("\x1b\r");
    expect(encodeKey(key("Backspace", { altKey: true }))).toBe("\x1b\x7f");
    expect(
      encodeKey(key("∂", { altKey: true, ctrlKey: true, code: "KeyD" })),
    ).toBe("\x1b\x04");
    expect(encodeKey(key("Alt", { altKey: true }))).toBeNull();
  });
});

describe("encodePaste", () => {
  it("turns newlines into carriage returns", () => {
    expect(encodePaste("a\nb\r\nc")).toBe("a\rb\rc");
  });
});

describe("wheelRows", () => {
  it("carries pixel remainders between events", () => {
    let state = { rows: 0, carry: 0 };
    state = wheelRows(state.carry, -10, 0, 16, 30);
    expect(state).toEqual({ rows: 0, carry: -10 });
    state = wheelRows(state.carry, -30, 0, 16, 30);
    expect(state).toEqual({ rows: -2, carry: -8 });
  });

  it("scrolls lines and pages directly", () => {
    expect(wheelRows(5, 3, 1, 16, 30)).toEqual({ rows: 3, carry: 0 });
    expect(wheelRows(0, -1, 2, 16, 30)).toEqual({ rows: -30, carry: 0 });
  });

  it("does nothing without a row height", () => {
    expect(wheelRows(0, 100, 0, 0, 30)).toEqual({ rows: 0, carry: 0 });
  });
});

describe("gridFor", () => {
  it("fits whole cells and keeps a minimum grid", () => {
    expect(gridFor(805, 413, { width: 8, height: 17 })).toEqual({
      cols: 100,
      rows: 24,
    });
    expect(gridFor(3, 3, { width: 8, height: 17 })).toEqual({
      cols: 2,
      rows: 1,
    });
    expect(gridFor(100, 100, { width: 0, height: 0 })).toEqual({
      cols: 2,
      rows: 1,
    });
  });
});
