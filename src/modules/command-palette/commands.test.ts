import { describe, expect, it, vi } from "vitest";

import {
  type CommandPaletteActionContext,
  createCommandItems,
} from "./commands";

function context(
  overrides: Partial<CommandPaletteActionContext> = {},
): CommandPaletteActionContext {
  const noop = vi.fn();
  return {
    tabs: [],
    activeId: 1,
    hasSelection: false,
    searchTarget: null,
    explorerRoot: "/tmp",
    home: "/Users/dev",
    openNewTab: noop,
    openNewBlock: noop,
    openNewPrivate: noop,
    openNewEditor: noop,
    openNewPreview: noop,
    openGitGraph: noop,
    toggleSourceControl: noop,
    closeActiveTabOrPane: noop,
    splitPaneRight: noop,
    splitPaneDown: noop,
    focusSearch: noop,
    focusExplorerSearch: noop,
    toggleSidebar: noop,
    toggleNotes: noop,
    toggleTasks: noop,
    newScheduledTask: noop,
    toggleAi: noop,
    askAiSelection: noop,
    readSelectionAloud: noop,
    readSelectionAloudSpanish: noop,
    readSelectionAloudEnglish: noop,
    stopReading: noop,
    openVoiceSettings: noop,
    openSettings: noop,
    openKeyboardShortcuts: noop,
    spaces: [],
    activeSpaceId: null,
    openSpacesOverview: noop,
    newSpace: noop,
    switchSpace: noop,
    ...overrides,
  };
}

describe("createCommandItems", () => {
  it("offers every side panel toggle, so no surface is reachable only by mouse", () => {
    const ids = createCommandItems(context()).map((item) => item.id);

    expect(ids).toContain("sidebar.toggle");
    expect(ids).toContain("notes.toggle");
    expect(ids).toContain("tasks.toggle");
  });

  it("offers creating a scheduled task without opening the panel first", () => {
    const ids = createCommandItems(context()).map((item) => item.id);
    expect(ids).toContain("tasks.new");
  });

  it("wires each panel entry to its own handler", () => {
    const toggleNotes = vi.fn();
    const toggleTasks = vi.fn();
    const newScheduledTask = vi.fn();
    const items = createCommandItems(
      context({ toggleNotes, toggleTasks, newScheduledTask }),
    );

    items.find((item) => item.id === "notes.toggle")?.run?.();
    items.find((item) => item.id === "tasks.toggle")?.run?.();
    items.find((item) => item.id === "tasks.new")?.run?.();

    expect(toggleNotes).toHaveBeenCalledTimes(1);
    expect(toggleTasks).toHaveBeenCalledTimes(1);
    expect(newScheduledTask).toHaveBeenCalledTimes(1);
  });

  it("groups the panel toggles under View and gives every item an icon", () => {
    const items = createCommandItems(context());
    for (const id of ["notes.toggle", "tasks.toggle"]) {
      const item = items.find((entry) => entry.id === id);
      expect(item?.group, id).toBe("View");
      expect(item?.icon, id).toBeDefined();
    }
  });

  it("keeps every id unique so the palette cannot render duplicates", () => {
    const ids = createCommandItems(context()).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes the scheduled entries findable by the words a user would type", () => {
    const items = createCommandItems(context());
    const tasks = items.find((item) => item.id === "tasks.toggle");
    expect(tasks?.keywords).toContain("schedule");
    expect(tasks?.keywords).toContain("cron");
  });

  it("groups the speech actions under Voice", () => {
    const items = createCommandItems(context());
    for (const id of [
      "tts.readSelection",
      "tts.readSelection.es",
      "tts.readSelection.en",
      "tts.stop",
      "tts.settings",
    ]) {
      const item = items.find((entry) => entry.id === id);
      expect(item?.group, id).toBe("Voice");
      expect(item?.icon, id).toBeDefined();
    }
  });

  it("disables reading aloud until something is selected", () => {
    const withoutSelection = createCommandItems(context());
    const withSelection = createCommandItems(context({ hasSelection: true }));
    for (const id of [
      "tts.readSelection",
      "tts.readSelection.es",
      "tts.readSelection.en",
    ]) {
      expect(
        withoutSelection.find((entry) => entry.id === id)?.disabledReason,
        id,
      ).toBe("No selection");
      expect(
        withSelection.find((entry) => entry.id === id)?.disabledReason,
        id,
      ).toBeUndefined();
    }
    // Stopping is about playback, not about a selection.
    expect(
      withoutSelection.find((entry) => entry.id === "tts.stop")?.disabledReason,
    ).toBeUndefined();
  });

  it("wires each voice entry to its own handler", () => {
    const readSelectionAloud = vi.fn();
    const readSelectionAloudSpanish = vi.fn();
    const readSelectionAloudEnglish = vi.fn();
    const stopReading = vi.fn();
    const openVoiceSettings = vi.fn();
    const items = createCommandItems(
      context({
        hasSelection: true,
        readSelectionAloud,
        readSelectionAloudSpanish,
        readSelectionAloudEnglish,
        stopReading,
        openVoiceSettings,
      }),
    );

    items.find((item) => item.id === "tts.readSelection")?.run?.();
    items.find((item) => item.id === "tts.readSelection.es")?.run?.();
    items.find((item) => item.id === "tts.readSelection.en")?.run?.();
    items.find((item) => item.id === "tts.stop")?.run?.();
    items.find((item) => item.id === "tts.settings")?.run?.();

    expect(readSelectionAloud).toHaveBeenCalledTimes(1);
    expect(readSelectionAloudSpanish).toHaveBeenCalledTimes(1);
    expect(readSelectionAloudEnglish).toHaveBeenCalledTimes(1);
    expect(stopReading).toHaveBeenCalledTimes(1);
    expect(openVoiceSettings).toHaveBeenCalledTimes(1);
  });
});
