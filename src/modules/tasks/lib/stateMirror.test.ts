import { describe, expect, it } from "vitest";
import { createStateMirror } from "./stateMirror";

describe("createStateMirror", () => {
  it("reads back a value committed before React re-renders", () => {
    // Pi calls tasks.add and then tasks.update with the returned id in the
    // same tick. Reading through React state would still see the old list.
    const mirror = createStateMirror<number[]>([]);

    const next = mirror.commit((current) => [...current, 1]);

    expect(next).toEqual([1]);
    expect(mirror.read()).toEqual([1]);
  });

  it("accumulates several commits in one tick", () => {
    const mirror = createStateMirror<number[]>([]);

    mirror.commit((current) => [...current, 1]);
    mirror.commit((current) => [...current, 2]);

    expect(mirror.read()).toEqual([1, 2]);
  });

  it("adopts a committed value that arrived from outside, such as hydration", () => {
    const mirror = createStateMirror<number[]>([]);

    mirror.sync([9, 8]);

    expect(mirror.read()).toEqual([9, 8]);
  });

  it("does not clobber a pending commit when an unrelated render replays the old state", () => {
    const initial: number[] = [];
    const mirror = createStateMirror<number[]>(initial);
    mirror.commit((current) => [...current, 1]);

    // Another piece of state changed, so the component re-rendered before the
    // task list state landed and sync() is called with the stale array.
    mirror.sync(initial);

    expect(mirror.read()).toEqual([1]);
  });

  it("adopts the committed value once React catches up", () => {
    const mirror = createStateMirror<number[]>([]);
    const committed = mirror.commit((current) => [...current, 1]);

    mirror.sync(committed);
    mirror.sync([1, 2]);

    expect(mirror.read()).toEqual([1, 2]);
  });
});
