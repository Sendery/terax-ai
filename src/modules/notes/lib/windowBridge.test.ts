import { describe, expect, it } from "vitest";
import { createTextCard } from "./cards";
import { isNotesSyncPayload, parseNotesAction } from "./windowBridge";

describe("isNotesSyncPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(
      isNotesSyncPayload({
        tabId: 10,
        tabTitle: "slot-3",
        notes: [createTextCard("hi")],
      }),
    ).toBe(true);
    expect(isNotesSyncPayload({ tabId: null, tabTitle: null, notes: [] })).toBe(
      true,
    );
  });

  it("rejects malformed payloads and invalid notes", () => {
    expect(isNotesSyncPayload(null)).toBe(false);
    expect(isNotesSyncPayload({ tabId: "x", tabTitle: null, notes: [] })).toBe(
      false,
    );
    expect(isNotesSyncPayload({ tabId: 1, tabTitle: 2, notes: [] })).toBe(false);
    expect(isNotesSyncPayload({ tabId: 1, tabTitle: null })).toBe(false);
    expect(
      isNotesSyncPayload({ tabId: 1, tabTitle: null, notes: [{ kind: "x" }] }),
    ).toBe(false);
  });
});

describe("parseNotesAction", () => {
  it("parses add-input", () => {
    expect(parseNotesAction({ type: "add-input", raw: "hello" })).toEqual({
      type: "add-input",
      raw: "hello",
    });
  });

  it("parses remove and move", () => {
    expect(parseNotesAction({ type: "remove", id: "a" })).toEqual({
      type: "remove",
      id: "a",
    });
    expect(parseNotesAction({ type: "move", id: "a", toIndex: 2 })).toEqual({
      type: "move",
      id: "a",
      toIndex: 2,
    });
  });

  it("sanitizes update patches to known, typed fields only", () => {
    const parsed = parseNotesAction({
      type: "update",
      id: "a",
      patch: {
        title: "T",
        prState: "merged",
        ciState: "success",
        status: "done",
        evil: "javascript:alert(1)",
        __proto__: { polluted: true },
      },
    });
    expect(parsed).not.toBeNull();
    if (parsed?.type !== "update") throw new Error("expected update");
    expect(parsed.patch).toEqual({
      title: "T",
      prState: "merged",
      ciState: "success",
      status: "done",
    });
  });

  it("drops invalid enum values in an update patch", () => {
    const parsed = parseNotesAction({
      type: "update",
      id: "a",
      patch: { prState: "bogus", ciState: 5, title: 9 },
    });
    if (parsed?.type !== "update") throw new Error("expected update");
    expect(parsed.patch).toEqual({});
  });

  it("parses cite and rejects empty/invalid text", () => {
    expect(parseNotesAction({ type: "cite", text: "https://x" })).toEqual({
      type: "cite",
      text: "https://x",
    });
    expect(parseNotesAction({ type: "cite", text: "" })).toBeNull();
    expect(parseNotesAction({ type: "cite" })).toBeNull();
    expect(parseNotesAction({ type: "cite", text: 5 })).toBeNull();
  });

  it("parses refresh and refresh-all", () => {
    expect(parseNotesAction({ type: "refresh", id: "a" })).toEqual({
      type: "refresh",
      id: "a",
    });
    expect(parseNotesAction({ type: "refresh-all" })).toEqual({
      type: "refresh-all",
    });
    expect(parseNotesAction({ type: "refresh" })).toBeNull();
  });

  it("rejects unknown or malformed actions", () => {
    expect(parseNotesAction(null)).toBeNull();
    expect(parseNotesAction({ type: "nope" })).toBeNull();
    expect(parseNotesAction({ type: "remove" })).toBeNull();
    expect(parseNotesAction({ type: "move", id: "a" })).toBeNull();
    expect(parseNotesAction({ type: "add-input", raw: 5 })).toBeNull();
  });
});
