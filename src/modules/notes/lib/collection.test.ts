import { describe, expect, it } from "vitest";
import { createTextCard, type NoteCard } from "./cards";
import { addCard, moveCard, removeCard, updateCard } from "./collection";

function sample(): NoteCard[] {
  return [
    createTextCard("first", "A"),
    createTextCard("second", "B"),
    createTextCard("third", "C"),
  ];
}

describe("addCard", () => {
  it("appends without mutating the input array", () => {
    const cards = sample();
    const card = createTextCard("new");
    const next = addCard(cards, card);
    expect(next).toHaveLength(4);
    expect(next[3]).toBe(card);
    expect(cards).toHaveLength(3); // original untouched
  });
});

describe("removeCard", () => {
  it("removes by id and leaves the rest untouched", () => {
    const cards = sample();
    const next = removeCard(cards, cards[1].id);
    expect(next.map((c) => c.id)).toEqual([cards[0].id, cards[2].id]);
    expect(cards).toHaveLength(3);
  });

  it("returns the same list when the id is absent", () => {
    const cards = sample();
    expect(removeCard(cards, "missing")).toEqual(cards);
  });
});

describe("updateCard", () => {
  it("applies a patch and bumps updatedAt", () => {
    const cards = sample();
    const target = cards[0];
    const next = updateCard(cards, target.id, { title: "renamed" }, target.updatedAt + 10);
    const updated = next[0];
    expect(updated).not.toBe(target);
    if (updated.kind !== "text") throw new Error("expected text card");
    expect(updated.title).toBe("renamed");
    expect(updated.updatedAt).toBeGreaterThan(target.updatedAt);
    expect(cards[0]).toBe(target); // original untouched
  });

  it("ignores updates to a missing id", () => {
    const cards = sample();
    expect(updateCard(cards, "missing", { title: "x" })).toEqual(cards);
  });
});

describe("moveCard", () => {
  it("reorders a card to a new index", () => {
    const cards = sample();
    const next = moveCard(cards, cards[0].id, 2);
    expect(next.map((c) => c.id)).toEqual([
      cards[1].id,
      cards[2].id,
      cards[0].id,
    ]);
  });

  it("clamps out-of-range target indices", () => {
    const cards = sample();
    const next = moveCard(cards, cards[2].id, 99);
    expect(next[next.length - 1].id).toBe(cards[2].id);
    const front = moveCard(cards, cards[2].id, -5);
    expect(front[0].id).toBe(cards[2].id);
  });

  it("returns the same list for a missing id", () => {
    const cards = sample();
    expect(moveCard(cards, "missing", 0)).toEqual(cards);
  });
});
