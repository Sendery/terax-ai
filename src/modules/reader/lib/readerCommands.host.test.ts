import type { Tab } from "@/modules/tabs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./native", () => ({
  readerNative: {
    open: vi.fn(async ({ title }: { title?: string }) => ({
      id: "0123456789ab",
      title,
    })),
    list: vi.fn(async () => []),
  },
}));
vi.mock("./player", () => ({
  adoptDocument: vi.fn((_stored: unknown, title?: string) => ({
    id: "0123456789ab",
    state: { title: title ?? "Untitled", lastWordIndex: 0 },
    doc: { words: [], segments: [] },
  })),
  deleteReaderDocs: vi.fn(),
  exportReader: vi.fn(async () => undefined),
  loadStored: vi.fn(),
  pauseReader: vi.fn(),
  playReader: vi.fn(async () => undefined),
  seekReaderTo: vi.fn(),
  setReaderSpeed: vi.fn(),
  setReaderVoice: vi.fn(),
  stepReader: vi.fn(),
  stopReader: vi.fn(),
  summarize: vi.fn(),
  toggleReader: vi.fn(),
  toggleReaderCut: vi.fn(),
}));

import { playReader } from "./player";
import { createReaderHandlers, type ReaderHost } from "./readerCommands";

const terminal = (id: number) =>
  ({ id, kind: "terminal", paneTree: { leaf: id } }) as unknown as Tab;
const reader = (id: number) =>
  ({ id, kind: "reader", docId: "aaaaaaaaaaaa" }) as unknown as Tab;

function makeHost(
  tabs: Tab[],
  activeId: number,
  ptyTabs: Record<number, number> = {},
) {
  const docked: Array<[number, string]> = [];
  const opened: string[] = [];
  const host: ReaderHost = {
    tabs: () => tabs,
    activeId: () => activeId,
    openReaderTab: ({ docId }) => {
      opened.push(docId);
      return 99;
    },
    dockReading: (tabId, entry) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || tab.kind === "reader") return false;
      docked.push([tabId, entry.id]);
      return true;
    },
    recordOrigin: vi.fn(),
    showLibrary: vi.fn(),
    closeDock: vi.fn(),
    forgetDeleted: vi.fn(),
    tabOfPty: (pty) => ptyTabs[pty] ?? null,
  };
  return { host, docked, opened };
}

beforeEach(() => vi.mocked(playReader).mockClear());

describe("reader.open from terax-read", () => {
  it("docks under the terminal that ran it, not the tab on screen", async () => {
    const { host, docked } = makeHost([terminal(1), terminal(2)], 2, { 7: 1 });
    const reply = (await createReaderHandlers(host).openReader({
      text: "hola",
      callerPtyId: 7,
      play: true,
    })) as { tabId: number; placement: string };
    expect(docked).toEqual([[1, "0123456789ab"]]);
    expect(reply).toMatchObject({ tabId: 1, placement: "dock" });
  });

  it("falls back to the tab on screen when that terminal is gone", async () => {
    const { host, docked } = makeHost([terminal(1), terminal(2)], 2, {});
    await createReaderHandlers(host).openReader({
      text: "hola",
      callerPtyId: 7,
    });
    expect(docked).toEqual([[2, "0123456789ab"]]);
  });

  it("lets an explicit tabId win over the calling terminal", async () => {
    const { host, docked } = makeHost([terminal(1), terminal(2)], 2, { 7: 1 });
    await createReaderHandlers(host).openReader({
      text: "hola",
      callerPtyId: 7,
      tabId: 2,
    });
    expect(docked).toEqual([[2, "0123456789ab"]]);
  });

  it("stays paused for an agent unless play is true", async () => {
    const { host } = makeHost([terminal(1)], 1);
    await createReaderHandlers(host).openReader({ text: "hola" });
    expect(playReader).not.toHaveBeenCalled();
    await createReaderHandlers(host).openReader({ text: "hola", play: true });
    expect(playReader).toHaveBeenCalledTimes(1);
  });
});

describe("reader.generate with show", () => {
  it("docks under the tab on screen and says so", async () => {
    const { host } = makeHost([terminal(1)], 1);
    const reply = (await createReaderHandlers(host).generateReader({
      text: "hola",
      split: "none",
      show: true,
    })) as { shown: unknown };
    expect(reply.shown).toEqual({ placement: "dock", tabId: 1 });
  });

  it("opens a Reader tab when the tab on screen is a Reader tab, instead of nothing", async () => {
    const { host, opened } = makeHost([reader(5)], 5);
    const reply = (await createReaderHandlers(host).generateReader({
      text: "hola",
      split: "none",
      show: true,
    })) as { shown: unknown };
    expect(opened).toEqual(["0123456789ab"]);
    expect(reply.shown).toEqual({ placement: "tab", tabId: 99 });
  });

  it("shows nothing and says so without show", async () => {
    const { host, opened } = makeHost([reader(5)], 5);
    const reply = (await createReaderHandlers(host).generateReader({
      text: "hola",
      split: "none",
    })) as { shown: unknown };
    expect(opened).toEqual([]);
    expect(reply.shown).toBeNull();
  });
});
