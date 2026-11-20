import type { Tab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import {
  dockTarget,
  NOTHING_TO_READ_REASON,
  PRIVATE_READ_REASON,
  READER_TAB_REASON,
  readHereReason,
  readsWholeDocument,
  speakReason,
} from "./readingAvailability";

const terminal = (id: number, priv = false) =>
  ({ id, kind: "terminal", private: priv }) as unknown as Tab;
const editor = (id: number) =>
  ({ id, kind: "editor", path: "/a.md" }) as unknown as Tab;
const markdown = (id: number) =>
  ({ id, kind: "markdown", path: "/a.md" }) as unknown as Tab;
const reader = (id: number) =>
  ({ id, kind: "reader", docId: "0123456789ab" }) as unknown as Tab;
const preview = (id: number) => ({ id, kind: "preview" }) as unknown as Tab;

describe("readHereReason", () => {
  it("lets terminals, editors and Markdown views read", () => {
    expect(readHereReason(terminal(1))).toBeNull();
    expect(readHereReason(editor(2))).toBeNull();
    expect(readHereReason(markdown(3))).toBeNull();
  });

  it("says why a private terminal, a Reader tab or a view without text cannot", () => {
    expect(readHereReason(terminal(1, true))).toBe(PRIVATE_READ_REASON);
    expect(readHereReason(reader(4))).toBe(READER_TAB_REASON);
    expect(readHereReason(preview(5))).toBe(NOTHING_TO_READ_REASON);
    expect(readHereReason(undefined)).toBe(NOTHING_TO_READ_REASON);
  });

  it("keeps the private reason for Speak and folds the Reader tab into no text", () => {
    expect(speakReason(terminal(1, true))).toBe(PRIVATE_READ_REASON);
    expect(speakReason(reader(4))).toBe(NOTHING_TO_READ_REASON);
    expect(speakReason(editor(2))).toBeNull();
  });

  it("reads the whole document only in editors and Markdown views", () => {
    expect(readsWholeDocument(editor(2))).toBe(true);
    expect(readsWholeDocument(markdown(3))).toBe(true);
    expect(readsWholeDocument(terminal(1))).toBe(false);
  });
});

describe("dockTarget", () => {
  const tabs = [terminal(1), editor(2), reader(3)];

  it("prefers the open origin, then the tab asked for, then the last content tab", () => {
    expect(dockTarget({ tabs, origin: 2, preferred: 1, lastContent: 1 })).toBe(
      2,
    );
    expect(
      dockTarget({ tabs, origin: null, preferred: 1, lastContent: 2 }),
    ).toBe(1);
    expect(
      dockTarget({ tabs, origin: null, preferred: 3, lastContent: 2 }),
    ).toBe(2);
  });

  it("never lands in a Reader tab or a closed tab", () => {
    expect(dockTarget({ tabs, origin: 9, preferred: 3, lastContent: 8 })).toBe(
      1,
    );
    expect(
      dockTarget({
        tabs: [reader(3)],
        origin: null,
        preferred: 3,
        lastContent: null,
      }),
    ).toBeNull();
  });
});
