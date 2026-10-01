import type { Tab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import { findAgentTab } from "./tabTarget";

const terminal = (over: Partial<Tab> = {}): Tab =>
  ({
    id: 1,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    cwd: "/repo/api",
    paneTree: { kind: "leaf", id: 10 },
    activeLeafId: 10,
    ...over,
  }) as Tab;

describe("findAgentTab", () => {
  it("finds the terminal tab owning a pane", () => {
    expect(findAgentTab([terminal()], 10)).toMatchObject({ tabId: 1 });
  });

  it("reports the label the tab bar shows, not the raw title", () => {
    // A terminal's `title` stays "shell" while the bar shows the cwd or the
    // name the user gave it, so a notification naming `title` pointed at a tab
    // the user could not find.
    expect(findAgentTab([terminal()], 10)?.title).toBe("api");
    expect(
      findAgentTab(
        [terminal({ customTitle: "api server" } as Partial<Tab>)],
        10,
      )?.title,
    ).toBe("api server");
  });

  it("carries the tab colour so a notification is recognisable", () => {
    expect(
      findAgentTab([terminal({ color: "purple" } as Partial<Tab>)], 10)?.color,
    ).toBe("purple");
  });

  it("has no colour when the tab has none", () => {
    expect(findAgentTab([terminal()], 10)?.color).toBeNull();
  });

  it("ignores tabs that are not terminals", () => {
    const editor = { id: 2, kind: "editor", spaceId: "default" } as Tab;

    expect(findAgentTab([editor], 10)).toBeNull();
  });

  it("returns nothing for an unknown pane", () => {
    expect(findAgentTab([terminal()], 99)).toBeNull();
  });
});
