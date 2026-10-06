import { describe, expect, it } from "vitest";

import {
  type CommitKeyEvent,
  createCompositionCommitFilter,
} from "./compositionCommit";

const key = (
  type: string,
  k: string,
  keyCode: number,
  extra: Partial<CommitKeyEvent> = {},
): CommitKeyEvent => ({
  type,
  key: k,
  keyCode,
  isComposing: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...extra,
});

const PASS = { kind: "pass" };
const SWALLOW = { kind: "swallow" };

describe("createCompositionCommitFilter", () => {
  it("swallows the WebKit keystroke that commits a dead key and forwards its text", () => {
    const f = createCompositionCommitFilter();
    expect(f.onKey(key("keydown", "Dead", 229, { isComposing: true }))).toEqual(
      PASS,
    );
    f.compositionEnded();
    expect(f.onKey(key("keydown", "~/", 192, { shiftKey: true }))).toEqual(
      SWALLOW,
    );
    expect(f.onKey(key("keypress", "~/", 126, { shiftKey: true }))).toEqual(
      SWALLOW,
    );
    expect(f.takeInput({ inputType: "insertText", data: "/" })).toBe("/");
    expect(f.onKey(key("keyup", "/", 191))).toEqual(PASS);
    expect(f.onKey(key("keydown", "a", 65))).toEqual(PASS);
  });

  it("leaves a combined character to the composition flush", () => {
    const f = createCompositionCommitFilter();
    f.compositionEnded();
    expect(f.onKey(key("keydown", "ñ", 229))).toEqual(PASS);
    expect(f.takeInput({ inputType: "insertText", data: "x" })).toBeNull();
  });

  it("sends Enter after a dead key as a carriage return", () => {
    const f = createCompositionCommitFilter();
    f.compositionEnded();
    expect(f.onKey(key("keydown", "~\r", 192))).toEqual({
      kind: "send",
      data: "\r",
    });
    expect(f.onKey(key("keypress", "~\r", 126))).toEqual(PASS);
    expect(
      f.takeInput({ inputType: "insertLineBreak", data: null }),
    ).toBeNull();
  });

  it("sends Tab and Shift+Tab after a dead key instead of moving focus", () => {
    const f = createCompositionCommitFilter();
    f.compositionEnded();
    expect(f.onKey(key("keydown", "~\t", 192))).toEqual({
      kind: "send",
      data: "\t",
    });
    f.compositionEnded();
    expect(f.onKey(key("keydown", "~\t", 192, { shiftKey: true }))).toEqual({
      kind: "send",
      data: "\x1b[Z",
    });
  });

  it("leaves Chromium alone, where keyup follows compositionend", () => {
    const f = createCompositionCommitFilter();
    expect(f.onKey(key("keydown", "/", 229, { isComposing: true }))).toEqual(
      PASS,
    );
    f.compositionEnded();
    expect(f.onKey(key("keyup", "/", 191))).toEqual(PASS);
    expect(f.onKey(key("keydown", "a", 65))).toEqual(PASS);
    expect(f.onKey(key("keypress", "a", 97))).toEqual(PASS);
  });

  it("lets named keys and shortcuts after a dead key through", () => {
    for (const k of ["Backspace", "ArrowLeft", "Escape", "F1"]) {
      const f = createCompositionCommitFilter();
      f.compositionEnded();
      expect(f.onKey(key("keydown", k, 8))).toEqual(PASS);
    }
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const f = createCompositionCommitFilter();
      f.compositionEnded();
      expect(f.onKey(key("keydown", "c", 67, mod))).toEqual(PASS);
    }
  });

  it("forwards only one input per swallowed keystroke", () => {
    const f = createCompositionCommitFilter();
    f.compositionEnded();
    f.onKey(key("keydown", "~/", 192));
    expect(f.takeInput({ inputType: "insertText", data: "/" })).toBe("/");
    expect(f.takeInput({ inputType: "insertText", data: "/" })).toBeNull();
  });
});
