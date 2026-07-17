import { describe, expect, it } from "vitest";
import {
  createCardFromUrl,
  createTextCard,
  type GithubPrCard,
} from "./cards";
import { buildEditPatch, draftFromCard, editableFields, hasEdit } from "./editing";

describe("editableFields", () => {
  it("exposes title and body for text cards", () => {
    expect(editableFields(createTextCard("hi"))).toEqual(["title", "body"]);
  });

  it("exposes title, url and note for link-backed cards", () => {
    const card = createCardFromUrl("https://example.com/x");
    expect(editableFields(card)).toEqual(["title", "url", "note"]);
  });
});

describe("draftFromCard", () => {
  it("seeds body from a text card and leaves url/note empty", () => {
    const card = createTextCard("hello world", "Greeting");
    expect(draftFromCard(card)).toEqual({
      title: "Greeting",
      body: "hello world",
      url: "",
      note: "",
    });
  });

  it("seeds title, url and note from a link card", () => {
    const base = createCardFromUrl("https://example.com/x");
    const card = { ...base, title: "Docs", note: "read later" } as typeof base;
    expect(draftFromCard(card)).toEqual({
      title: "Docs",
      body: "",
      url: "https://example.com/x",
      note: "read later",
    });
  });
});

describe("buildEditPatch", () => {
  it("returns an empty patch when nothing changed", () => {
    const card = createTextCard("hello", "Title");
    expect(buildEditPatch(card, draftFromCard(card))).toEqual({});
    expect(hasEdit(card, draftFromCard(card))).toBe(false);
  });

  it("patches a changed text body and title", () => {
    const card = createTextCard("old body", "Old");
    const patch = buildEditPatch(card, {
      title: "New",
      body: "new body",
      url: "",
      note: "",
    });
    expect(patch).toEqual({ title: "New", body: "new body" });
  });

  it("never blanks a text body (keeps original when draft is empty)", () => {
    const card = createTextCard("keep me");
    const patch = buildEditPatch(card, {
      title: "",
      body: "   ",
      url: "",
      note: "",
    });
    expect(patch.body).toBeUndefined();
  });

  it("patches a changed link url", () => {
    const card = createCardFromUrl("https://example.com/x");
    const patch = buildEditPatch(card, {
      ...draftFromCard(card),
      url: "https://example.com/y",
    });
    expect(patch).toEqual({ url: "https://example.com/y" });
  });

  it("never blanks a link url", () => {
    const card = createCardFromUrl("https://example.com/x");
    const patch = buildEditPatch(card, { ...draftFromCard(card), url: "   " });
    expect(patch.url).toBeUndefined();
  });

  it("clears a link title and annotation when emptied", () => {
    const base = createCardFromUrl("https://example.com/x");
    const card = { ...base, title: "T", note: "N" } as typeof base;
    const patch = buildEditPatch(card, {
      ...draftFromCard(card),
      title: "",
      note: "",
    });
    expect(patch).toEqual({ title: "", note: "" });
  });

  it("ignores body edits on link cards", () => {
    const card = createCardFromUrl(
      "https://github.com/o/r/pull/1",
    ) as GithubPrCard;
    const patch = buildEditPatch(card, {
      title: "PR title",
      body: "ignored",
      url: card.url,
      note: "note",
    });
    expect(patch).toEqual({ title: "PR title", note: "note" });
    expect("body" in patch).toBe(false);
  });

  it("trims whitespace around edited values", () => {
    const card = createTextCard("old");
    expect(
      buildEditPatch(card, {
        title: "  T  ",
        body: "  new  ",
        url: "",
        note: "",
      }),
    ).toEqual({ title: "T", body: "new" });
  });
});
