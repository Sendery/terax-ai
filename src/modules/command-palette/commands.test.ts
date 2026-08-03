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
});
