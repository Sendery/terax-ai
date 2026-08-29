import { describe, expect, it } from "vitest";
import {
  commitVisualHistory,
  createVisualHistory,
  redoVisualHistory,
  resetVisualHistory,
  takeVisualHistoryStep,
  undoVisualHistory,
} from "./visualHistory";

describe("visual history", () => {
  it("commits, undoes, and redoes immutable states", () => {
    let history = createVisualHistory({ value: 1 });
    history = commitVisualHistory(history, { value: 2 });
    history = commitVisualHistory(history, { value: 3 });

    history = undoVisualHistory(history);
    expect(history.present).toEqual({ value: 2 });
    history = undoVisualHistory(history);
    expect(history.present).toEqual({ value: 1 });
    history = redoVisualHistory(history);
    expect(history.present).toEqual({ value: 2 });
  });

  it("clears redo states after a new commit", () => {
    let history = createVisualHistory("a");
    history = commitVisualHistory(history, "b");
    history = undoVisualHistory(history);
    history = commitVisualHistory(history, "c");
    expect(redoVisualHistory(history)).toBe(history);
  });

  it("resets all history when source changes outside visual mode", () => {
    let history = createVisualHistory("old");
    history = commitVisualHistory(history, "visual edit");
    history = resetVisualHistory("external source");
    expect(history).toEqual({
      past: [],
      present: "external source",
      future: [],
    });
  });

  it("retains only the latest 50 undo states", () => {
    let history = createVisualHistory(0);
    for (let value = 1; value <= 75; value += 1) {
      history = commitVisualHistory(history, value);
    }
    expect(history.past).toHaveLength(50);
    for (let count = 0; count < 50; count += 1) {
      history = undoVisualHistory(history);
    }
    expect(history.present).toBe(25);
  });

  it("returns the same object when undo or redo is unavailable", () => {
    const history = createVisualHistory("only");
    expect(undoVisualHistory(history)).toBe(history);
    expect(redoVisualHistory(history)).toBe(history);
  });

  it("returns no publishable step for unavailable undo and redo", () => {
    const history = createVisualHistory("only");
    expect(takeVisualHistoryStep(history, "undo")).toBeNull();
    expect(takeVisualHistoryStep(history, "redo")).toBeNull();

    const committed = commitVisualHistory(history, "next");
    expect(takeVisualHistoryStep(committed, "undo")?.present).toBe("only");
  });
});
