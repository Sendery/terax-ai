import { describe, expect, it } from "vitest";
import { readerKeyAction } from "./keys";

describe("readerKeyAction", () => {
  it("maps the documented keys", () => {
    expect(readerKeyAction({ key: " " })).toEqual({ type: "toggle" });
    expect(readerKeyAction({ key: "ArrowRight" })).toEqual({
      type: "segment",
      delta: 1,
    });
    expect(readerKeyAction({ key: "ArrowLeft", shiftKey: true })).toEqual({
      type: "skipMs",
      deltaMs: -10_000,
    });
    expect(readerKeyAction({ key: "j" })).toEqual({ type: "scroll", lines: 3 });
    expect(readerKeyAction({ key: "}" })).toEqual({
      type: "cursorBlock",
      delta: 1,
    });
    expect(readerKeyAction({ key: "m" })).toEqual({
      type: "cut",
      kind: "bookmark",
    });
    expect(readerKeyAction({ key: "P", shiftKey: true })).toEqual({
      type: "cut",
      kind: "stop",
    });
    expect(readerKeyAction({ key: "Tab", shiftKey: true })).toEqual({
      type: "jumpCut",
      direction: -1,
    });
    expect(readerKeyAction({ key: "+" })).toEqual({
      type: "speed",
      direction: 1,
    });
  });

  it("leaves chords and unknown keys to the app", () => {
    expect(readerKeyAction({ key: "w", metaKey: true })).toBeNull();
    expect(readerKeyAction({ key: "c", ctrlKey: true })).toBeNull();
    expect(readerKeyAction({ key: "x" })).toBeNull();
  });
});
