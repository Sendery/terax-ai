import { TAB_COLORS } from "@/modules/tabs";
import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_IDS,
  type CommandHandlers,
  createCommandRegistry,
  describeCommands,
  normalizeCommandError,
  PI_ALLOWED_COMMAND_IDS,
  validateCommandRequest,
} from "./registry";

function handlers(): CommandHandlers {
  return {
    getSnapshot: vi.fn(async () => ({
      version: 1 as const,
      tabs: [],
      activeTabId: null,
      activeSpaceId: null,
    })),
    showSidebar: vi.fn(async () => ({ visible: true, view: "explorer" })),
    hideSidebar: vi.fn(async () => ({ visible: false })),
    openFile: vi.fn(async () => ({ tabId: 7 })),
    openPreview: vi.fn(async () => ({
      tabId: 12,
      url: "http://localhost:19432/",
      created: true,
    })),
    focusTab: vi.fn(async () => ({ tabId: 2 })),
    closeTab: vi.fn(async () => ({ requested: true })),
    renameTab: vi.fn(async () => ({ tabId: 2 })),
    resetTabTitle: vi.fn(async () => ({ tabId: 2 })),
    openGitDiff: vi.fn(async () => ({ tabId: 8 })),
    openSettings: vi.fn(async () => ({ opened: true })),
    setTabColor: vi.fn(async () => ({ tabId: 2 })),
    getBuildInfo: vi.fn(() => ({
      repository: "Sendery/terax-ai",
      branch: "main",
      commit: "abc1234",
      channel: "development" as const,
    })),
    showAgentMonitor: vi.fn(() => ({ visible: true })),
    hideAgentMonitor: vi.fn(() => ({ visible: false })),
    toggleAgentMonitor: vi.fn(() => ({ toggled: true })),
    capture: vi.fn(async () => ({
      target: "window" as const,
      path: "/tmp/capture.png",
      width: 100,
      height: 100,
      bytes: 1000,
      format: "png" as const,
    })),
    showNotes: vi.fn(() => ({ visible: true })),
    hideNotes: vi.fn(() => ({ visible: false })),
    toggleNotes: vi.fn(() => ({ toggled: true })),
    detachNotes: vi.fn(() => ({ detached: true })),
    attachNotes: vi.fn(() => ({ detached: false })),
    addNote: vi.fn(() => ({ id: "nc-1", kind: "text", tabId: 1 })),
    removeNote: vi.fn(() => ({ removed: true, id: "nc-1" })),
    updateNote: vi.fn(() => ({ updated: true, id: "nc-1", tabId: 1 })),
    listNotes: vi.fn(() => ({ tabId: 1, notes: [] })),
    showTasks: vi.fn(() => ({ visible: true })),
    hideTasks: vi.fn(() => ({ visible: false })),
    toggleTasks: vi.fn(() => ({ toggled: true })),
    showHistory: vi.fn(() => ({ visible: true })),
    hideHistory: vi.fn(() => ({ visible: false })),
    toggleHistory: vi.fn(() => ({ toggled: true })),
    openTaskEditor: vi.fn(() => ({ opened: true })),
    listTasks: vi.fn(() => ({ paused: false, tasks: [] })),
    addTask: vi.fn(() => ({ id: "st-1" })),
    updateTask: vi.fn(() => ({ id: "st-1", updated: true })),
    removeTask: vi.fn(() => ({ id: "st-1", removed: true })),
    runTask: vi.fn(() => ({ id: "st-1", started: true })),
    setTaskEnabled: vi.fn(() => ({ id: "st-1", enabled: false })),
    pauseAllTasks: vi.fn(() => ({ paused: true })),
    resumeAllTasks: vi.fn(() => ({ paused: false })),
    wakeTasks: vi.fn(() => ({ dispatched: 0 })),
  };
}

describe("notes commands", () => {
  it("accepts the no-payload notes commands", () => {
    for (const id of [
      "notes.show",
      "notes.hide",
      "notes.toggle",
      "notes.detach",
      "notes.attach",
      "notes.list",
    ] as const) {
      expect(validateCommandRequest({ id }).ok).toBe(true);
    }
  });

  it("validates notes.add content", () => {
    expect(
      validateCommandRequest({ id: "notes.add", payload: { content: "hi" } })
        .ok,
    ).toBe(true);
    expect(validateCommandRequest({ id: "notes.add", payload: {} }).ok).toBe(
      false,
    );
    expect(
      validateCommandRequest({ id: "notes.add", payload: { content: "" } }).ok,
    ).toBe(false);
  });

  it("validates notes.remove id", () => {
    expect(
      validateCommandRequest({ id: "notes.remove", payload: { id: "a" } }).ok,
    ).toBe(true);
    expect(validateCommandRequest({ id: "notes.remove", payload: {} }).ok).toBe(
      false,
    );
  });

  it("validates notes.update: id required, at least one field, string fields", () => {
    expect(
      validateCommandRequest({
        id: "notes.update",
        payload: { id: "a", title: "New" },
      }).ok,
    ).toBe(true);
    // missing id
    expect(
      validateCommandRequest({ id: "notes.update", payload: { title: "x" } })
        .ok,
    ).toBe(false);
    // no editable field
    expect(
      validateCommandRequest({ id: "notes.update", payload: { id: "a" } }).ok,
    ).toBe(false);
    // non-string field
    expect(
      validateCommandRequest({
        id: "notes.update",
        payload: { id: "a", body: 5 },
      }).ok,
    ).toBe(false);
  });

  it("dispatches notes.update with only the provided fields", async () => {
    const h = handlers();
    const reg = createCommandRegistry(h);
    const res = await reg.call({
      id: "notes.update",
      payload: { id: "nc-1", url: "https://x/y", note: "n" },
    });
    expect(res.ok).toBe(true);
    expect(h.updateNote).toHaveBeenCalledWith({
      id: "nc-1",
      url: "https://x/y",
      note: "n",
    });
  });

  it("dispatches notes.add and notes.remove to handlers", async () => {
    const h = handlers();
    const reg = createCommandRegistry(h);
    const added = await reg.call({
      id: "notes.add",
      payload: { content: "https://github.com/a/b/pull/1" },
    });
    expect(added.ok).toBe(true);
    expect(h.addNote).toHaveBeenCalledWith({
      content: "https://github.com/a/b/pull/1",
    });
    const removed = await reg.call({
      id: "notes.remove",
      payload: { id: "nc-1" },
    });
    expect(removed.ok).toBe(true);
    expect(h.removeNote).toHaveBeenCalledWith({ id: "nc-1" });
  });

  it("does not dispatch notes.add when the payload is invalid", async () => {
    const h = handlers();
    const reg = createCommandRegistry(h);
    const res = await reg.call({ id: "notes.add", payload: {} });
    expect(res.ok).toBe(false);
    expect(h.addNote).not.toHaveBeenCalled();
  });
});

describe("agent monitor commands", () => {
  it("accepts and dispatches the no-payload monitor controls", async () => {
    const h = handlers() as CommandHandlers & {
      showAgentMonitor: ReturnType<typeof vi.fn>;
      hideAgentMonitor: ReturnType<typeof vi.fn>;
      toggleAgentMonitor: ReturnType<typeof vi.fn>;
    };
    h.showAgentMonitor = vi.fn(() => ({ visible: true }));
    h.hideAgentMonitor = vi.fn(() => ({ visible: false }));
    h.toggleAgentMonitor = vi.fn(() => ({ toggled: true }));
    const registry = createCommandRegistry(h);

    for (const id of [
      "agent-monitor.show",
      "agent-monitor.hide",
      "agent-monitor.toggle",
    ]) {
      expect(validateCommandRequest({ id }).ok).toBe(true);
    }

    await registry.call({ id: "agent-monitor.show" });
    await registry.call({ id: "agent-monitor.hide" });
    await registry.call({ id: "agent-monitor.toggle" });
    expect(h.showAgentMonitor).toHaveBeenCalledOnce();
    expect(h.hideAgentMonitor).toHaveBeenCalledOnce();
    expect(h.toggleAgentMonitor).toHaveBeenCalledOnce();
  });
});

describe("app.capture", () => {
  it("accepts every closed capture target", () => {
    for (const target of [
      "window",
      "header",
      "sidebar",
      "tabstrip",
      "statusbar",
      "active-pane",
      "overlay",
    ]) {
      expect(
        validateCommandRequest({ id: "app.capture", payload: { target } }),
      ).toEqual({
        ok: true,
        value: { id: "app.capture", payload: { target } },
      });
    }
  });

  it("requires tabId for pane captures and rejects it elsewhere", () => {
    expect(
      validateCommandRequest({ id: "app.capture", payload: { target: "pane" } })
        .ok,
    ).toBe(false);
    expect(
      validateCommandRequest({
        id: "app.capture",
        payload: { target: "pane", tabId: 4 },
      }),
    ).toEqual({
      ok: true,
      value: { id: "app.capture", payload: { target: "pane", tabId: 4 } },
    });
    expect(
      validateCommandRequest({
        id: "app.capture",
        payload: { target: "sidebar", tabId: 4 },
      }).ok,
    ).toBe(false);
  });

  it("rejects arbitrary selectors as targets", () => {
    expect(
      validateCommandRequest({
        id: "app.capture",
        payload: { target: "#root" },
      }).ok,
    ).toBe(false);
  });

  it("dispatches to the capture handler", async () => {
    const h = handlers();
    const registry = createCommandRegistry(h);
    const result = await registry.call({
      id: "app.capture",
      payload: { target: "window" },
    });
    expect(result.ok).toBe(true);
    expect(h.capture).toHaveBeenCalledWith({ target: "window" });
  });

  it("documents the capture target enum", () => {
    const entry = describeCommands().commands.find(
      (c) => c.id === "app.capture",
    );
    expect(entry).toBeDefined();
    const target = entry?.params.find((p) => p.name === "target");
    expect(target?.type).toBe("enum");
    expect(target?.values).toContain("window");
    expect(target?.values).toContain("pane");
  });
});

describe("preview.open command", () => {
  it("accepts loopback http(s) URLs", () => {
    for (const url of [
      "http://localhost:19432/",
      "http://127.0.0.1:5173/canvas",
      "https://localhost:8443",
    ]) {
      expect(
        validateCommandRequest({ id: "preview.open", payload: { url } }).ok,
        url,
      ).toBe(true);
    }
  });

  it("requires payload.url", () => {
    expect(validateCommandRequest({ id: "preview.open", payload: {} })).toEqual(
      {
        ok: false,
        error: {
          code: "invalid_payload",
          message: "preview.open requires payload.url",
        },
      },
    );
    expect(
      validateCommandRequest({ id: "preview.open", payload: undefined }).ok,
    ).toBe(false);
  });

  it("rejects non-loopback and non-http URLs", () => {
    for (const url of [
      "http://example.com",
      "https://localhost.evil.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "localhost:19432",
      42,
    ]) {
      const result = validateCommandRequest({
        id: "preview.open",
        payload: { url },
      });
      expect(result.ok, String(url)).toBe(false);
    }
  });

  it("passes an optional title through and rejects a non-string title", () => {
    expect(
      validateCommandRequest({
        id: "preview.open",
        payload: { url: "http://localhost:19432/", title: "Excalidraw" },
      }),
    ).toEqual({
      ok: true,
      value: {
        id: "preview.open",
        payload: { url: "http://localhost:19432/", title: "Excalidraw" },
      },
    });
    expect(
      validateCommandRequest({
        id: "preview.open",
        payload: { url: "http://localhost:19432/", title: 7 },
      }).ok,
    ).toBe(false);
  });

  it("dispatches valid requests and never calls the handler on rejection", async () => {
    const h = handlers();
    const registry = createCommandRegistry(h);
    const ok = await registry.call({
      id: "preview.open",
      payload: { url: "http://localhost:19432/" },
    });
    expect(ok).toEqual({
      ok: true,
      value: { tabId: 12, url: "http://localhost:19432/", created: true },
    });
    expect(h.openPreview).toHaveBeenCalledTimes(1);

    const rejected = await registry.call({
      id: "preview.open",
      payload: { url: "http://example.com" },
    });
    expect(rejected.ok).toBe(false);
    expect(h.openPreview).toHaveBeenCalledTimes(1);
  });
});

describe("describeCommands", () => {
  it("documents a schema entry for every command id", () => {
    const catalog = describeCommands();
    const documented = catalog.commands.map((c) => c.id).sort();
    expect(documented).toEqual([...COMMAND_IDS].sort());
  });

  it("documents app.buildInfo as a no-payload read command", () => {
    const entry = describeCommands().commands.find(
      (c) => c.id === "app.buildInfo",
    );
    expect(entry).toBeDefined();
    expect(entry?.params).toEqual([]);
  });

  it("exposes tab.setColor supported arguments including the color palette", () => {
    const entry = describeCommands().commands.find(
      (c) => c.id === "tab.setColor",
    );
    expect(entry).toBeDefined();
    const tabId = entry?.params.find((p) => p.name === "tabId");
    const color = entry?.params.find((p) => p.name === "color");
    expect(tabId?.required).toBe(true);
    expect(tabId?.type).toBe("integer");
    expect(color?.required).toBe(true);
    expect(color?.type).toBe("enum");
    expect(color?.nullable).toBe(true);
    expect(color?.values).toEqual([...TAB_COLORS]);
  });

  it("is reachable as a read command through the registry", async () => {
    const registry = createCommandRegistry(handlers());
    const result = await registry.call({ id: "app.commands" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.value as ReturnType<typeof describeCommands>).commands.length,
      ).toBe(COMMAND_IDS.length);
    }
  });
});

describe("app.buildInfo command", () => {
  it("returns build provenance from the handler", async () => {
    const h = handlers();
    const registry = createCommandRegistry(h);
    const result = await registry.call({ id: "app.buildInfo" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        repository: "Sendery/terax-ai",
        commit: "abc1234",
        channel: "development",
      });
    }
    expect(h.getBuildInfo).toHaveBeenCalledOnce();
  });

  it("rejects a payload on app.buildInfo", () => {
    const result = validateCommandRequest({
      id: "app.buildInfo",
      payload: { anything: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_payload");
  });
});

describe("command registry", () => {
  it("rejects unknown command ids before dispatch", async () => {
    const registry = createCommandRegistry(handlers());

    await expect(
      registry.call({ id: "ai.diff.approve", payload: {} }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "unknown_command",
        message: 'Unknown command "ai.diff.approve"',
      },
    });
  });

  it("accepts JSON null for commands without required payload fields", () => {
    expect(
      validateCommandRequest({ id: "app.snapshot", payload: null }),
    ).toEqual({
      ok: true,
      value: { id: "app.snapshot" },
    });
    expect(
      validateCommandRequest({ id: "sidebar.show", payload: null }),
    ).toEqual({
      ok: true,
      value: { id: "sidebar.show", payload: { view: undefined } },
    });
    expect(
      validateCommandRequest({ id: "settings.open", payload: null }),
    ).toEqual({
      ok: true,
      value: { id: "settings.open", payload: { tab: undefined } },
    });
  });

  it("validates payloads for known commands", () => {
    expect(validateCommandRequest({ id: "tab.openFile", payload: {} })).toEqual(
      {
        ok: false,
        error: {
          code: "invalid_payload",
          message: "tab.openFile requires payload.path",
        },
      },
    );

    expect(
      validateCommandRequest({
        id: "git.diff.open",
        payload: { repoRoot: "/repo", path: "a.ts", mode: "+" },
      }),
    ).toEqual({
      ok: true,
      value: {
        id: "git.diff.open",
        payload: { repoRoot: "/repo", path: "a.ts", mode: "+" },
      },
    });
  });

  it("normalizes thrown errors without exposing stack traces", () => {
    const normalized = normalizeCommandError(new Error("boom"));

    expect(normalized).toEqual({
      code: "internal_error",
      message: "boom",
    });
    expect(JSON.stringify(normalized)).not.toContain("at ");
  });

  it("keeps Pi command allowlist compact and excludes AI diff internals", () => {
    expect(PI_ALLOWED_COMMAND_IDS).toEqual([
      "app.snapshot",
      "app.commands",
      "app.buildInfo",
      "app.capture",
      "sidebar.show",
      "sidebar.hide",
      "tab.openFile",
      "preview.open",
      "tab.focus",
      "tab.close",
      "tab.rename",
      "tab.resetTitle",
      "tab.setColor",
      "git.diff.open",
      "settings.open",
      "agent-monitor.show",
      "agent-monitor.hide",
      "agent-monitor.toggle",
      "notes.show",
      "notes.hide",
      "notes.toggle",
      "notes.detach",
      "notes.attach",
      "notes.add",
      "notes.remove",
      "notes.update",
      "notes.list",
      "tasks.show",
      "tasks.hide",
      "tasks.toggle",
      "history.show",
      "history.hide",
      "history.toggle",
      "tasks.openEditor",
      "tasks.list",
      "tasks.add",
      "tasks.update",
      "tasks.remove",
      "tasks.run",
      "tasks.setEnabled",
      "tasks.pauseAll",
      "tasks.resumeAll",
      "tasks.wake",
    ]);
    expect(PI_ALLOWED_COMMAND_IDS).not.toContain("ai.diff.approve");
  });
});

describe("scheduled task commands", () => {
  it("routes the history panel commands to their handlers", async () => {
    const h = handlers();
    const reg = createCommandRegistry(h);

    expect((await reg.call({ id: "history.show" })).ok).toBe(true);
    expect((await reg.call({ id: "history.hide" })).ok).toBe(true);
    expect((await reg.call({ id: "history.toggle" })).ok).toBe(true);

    expect(h.showHistory).toHaveBeenCalledTimes(1);
    expect(h.hideHistory).toHaveBeenCalledTimes(1);
    expect(h.toggleHistory).toHaveBeenCalledTimes(1);
  });

  it("rejects a history command that carries a payload, without running it", async () => {
    // A rejected command must not reach the handler at all.
    const h = handlers();
    const reg = createCommandRegistry(h);

    const res = await reg.call({ id: "history.toggle", payload: { on: true } });

    expect(res.ok).toBe(false);
    expect(h.toggleHistory).not.toHaveBeenCalled();
  });

  it("accepts the no-payload task commands", () => {
    for (const id of [
      "tasks.show",
      "tasks.hide",
      "tasks.toggle",
      "history.show",
      "history.hide",
      "history.toggle",
      "tasks.list",
      "tasks.pauseAll",
      "tasks.resumeAll",
      "tasks.wake",
    ]) {
      expect(validateCommandRequest({ id }).ok).toBe(true);
      expect(validateCommandRequest({ id, payload: { x: 1 } }).ok).toBe(false);
    }
  });

  it("opens the editor with or without a task id", () => {
    expect(validateCommandRequest({ id: "tasks.openEditor" }).ok).toBe(true);
    expect(
      validateCommandRequest({ id: "tasks.openEditor", payload: {} }).ok,
    ).toBe(true);
    expect(
      validateCommandRequest({
        id: "tasks.openEditor",
        payload: { id: "st-1" },
      }).ok,
    ).toBe(true);
    for (const bad of ["", 7, null]) {
      expect(
        validateCommandRequest({
          id: "tasks.openEditor",
          payload: { id: bad },
        }).ok,
        String(bad),
      ).toBe(false);
    }
  });

  it("requires a name, prompt and schedule to add a task", () => {
    expect(validateCommandRequest({ id: "tasks.add", payload: {} }).ok).toBe(
      false,
    );
    expect(
      validateCommandRequest({
        id: "tasks.add",
        payload: { name: "n", prompt: "p" },
      }).ok,
    ).toBe(false);
    expect(
      validateCommandRequest({
        id: "tasks.add",
        payload: { name: "n", prompt: "p", schedule: "every:30m" },
      }).ok,
    ).toBe(true);
  });

  it("rejects a schedule spec it cannot parse", () => {
    const result = validateCommandRequest({
      id: "tasks.add",
      payload: { name: "n", prompt: "p", schedule: "hourly" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_payload");
  });

  it("accepts every documented schedule spec form", () => {
    for (const schedule of [
      "manual",
      "every:30m",
      "every:2h",
      "every:1d",
      "daily:09:00",
      "weekly:mon,wed@07:30",
      "weekly:weekdays@08:00",
      "weekly:weekend@10:00",
      "days:3@06:00:2026-08-01",
      "dates:2026-08-04,2026-08-09@12:00",
      "once:2026-08-04T09:15",
    ]) {
      const result = validateCommandRequest({
        id: "tasks.add",
        payload: { name: "n", prompt: "p", schedule },
      });
      expect(result.ok, schedule).toBe(true);
    }
  });

  it("rejects values outside the closed enums", () => {
    for (const payload of [
      { target: "window" },
      { mode: "other" },
      { missed: "maybe" },
      { overlap: "later" },
    ]) {
      const result = validateCommandRequest({
        id: "tasks.add",
        payload: { name: "n", prompt: "p", schedule: "every:30m", ...payload },
      });
      expect(result.ok, JSON.stringify(payload)).toBe(false);
    }
  });

  it("rejects a negative or fractional run budget", () => {
    for (const maxRuns of [-1, 1.5]) {
      expect(
        validateCommandRequest({
          id: "tasks.add",
          payload: { name: "n", prompt: "p", schedule: "every:30m", maxRuns },
        }).ok,
      ).toBe(false);
    }
  });

  it("does not let tasks.add set the enabled flag", () => {
    expect(
      validateCommandRequest({
        id: "tasks.add",
        payload: {
          name: "n",
          prompt: "p",
          schedule: "every:30m",
          enabled: false,
        },
      }).ok,
    ).toBe(false);
  });

  it("requires an id plus one field to update a task", () => {
    expect(
      validateCommandRequest({ id: "tasks.update", payload: { id: "st-1" } }).ok,
    ).toBe(false);
    expect(
      validateCommandRequest({
        id: "tasks.update",
        payload: { id: "st-1", enabled: false },
      }).ok,
    ).toBe(true);
  });

  it("requires an id for remove, run and setEnabled", () => {
    for (const id of ["tasks.remove", "tasks.run", "tasks.setEnabled"]) {
      expect(validateCommandRequest({ id, payload: {} }).ok).toBe(false);
    }
    expect(
      validateCommandRequest({
        id: "tasks.setEnabled",
        payload: { id: "st-1" },
      }).ok,
    ).toBe(false);
    expect(
      validateCommandRequest({
        id: "tasks.setEnabled",
        payload: { id: "st-1", enabled: true },
      }).ok,
    ).toBe(true);
  });

  it("never runs a handler for a rejected task command", async () => {
    const h = handlers();
    const registry = createCommandRegistry(h);
    const rejected = await registry.call({
      id: "tasks.add",
      payload: { name: "n", prompt: "p", schedule: "nonsense" },
    });
    expect(rejected.ok).toBe(false);
    expect(h.addTask).not.toHaveBeenCalled();
    const alsoRejected = await registry.call({
      id: "tasks.update",
      payload: { id: "st-1" },
    });
    expect(alsoRejected.ok).toBe(false);
    expect(h.updateTask).not.toHaveBeenCalled();
  });

  it("describes every task command in the catalog", () => {
    const catalog = describeCommands();
    const ids = catalog.commands.map((c) => c.id);
    for (const id of COMMAND_IDS.filter((c) => c.startsWith("tasks."))) {
      expect(ids).toContain(id);
    }
    const add = catalog.commands.find((c) => c.id === "tasks.add");
    expect(add?.params.find((p) => p.name === "schedule")?.required).toBe(true);
    expect(add?.params.find((p) => p.name === "target")?.values).toEqual([
      "headless",
      "tab",
    ]);
  });
});

describe("tab.setColor command", () => {
  it("validates that tabId is required", () => {
    expect(
      validateCommandRequest({ id: "tab.setColor", payload: { color: "red" } }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_payload",
        message: "tab.setColor requires payload.tabId",
      },
    });
  });

  it("accepts a valid palette color", () => {
    expect(
      validateCommandRequest({
        id: "tab.setColor",
        payload: { tabId: 1, color: "blue" },
      }),
    ).toEqual({
      ok: true,
      value: { id: "tab.setColor", payload: { tabId: 1, color: "blue" } },
    });
  });

  it("accepts null color to reset", () => {
    expect(
      validateCommandRequest({
        id: "tab.setColor",
        payload: { tabId: 1, color: null },
      }),
    ).toEqual({
      ok: true,
      value: { id: "tab.setColor", payload: { tabId: 1, color: null } },
    });
  });

  it("rejects an unknown color name", () => {
    expect(
      validateCommandRequest({
        id: "tab.setColor",
        payload: { tabId: 1, color: "yellow" },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_payload",
        message:
          "tab.setColor requires payload.color to be a palette color or null",
      },
    });
  });

  it("rejects a non-string non-null color value", () => {
    expect(
      validateCommandRequest({
        id: "tab.setColor",
        payload: { tabId: 1, color: 42 },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_payload",
        message:
          "tab.setColor requires payload.color to be a palette color or null",
      },
    });
  });

  it("dispatches to setTabColor handler", async () => {
    const h = handlers();
    const registry = createCommandRegistry(h);
    const result = await registry.call({
      id: "tab.setColor",
      payload: { tabId: 2, color: "purple" },
    });
    expect(result.ok).toBe(true);
    expect(h.setTabColor).toHaveBeenCalledWith({ tabId: 2, color: "purple" });
  });

  it("dispatches reset with null color", async () => {
    const h = handlers();
    const registry = createCommandRegistry(h);
    const result = await registry.call({
      id: "tab.setColor",
      payload: { tabId: 3, color: null },
    });
    expect(result.ok).toBe(true);
    expect(h.setTabColor).toHaveBeenCalledWith({ tabId: 3, color: null });
  });

  it("fails safely when the tab does not exist", async () => {
    const h = handlers();
    (h.setTabColor as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: "command_failed",
      message: "Tab 999 not found",
    });
    const registry = createCommandRegistry(h);
    const result = await registry.call({
      id: "tab.setColor",
      payload: { tabId: 999, color: "red" },
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: { code: string } }).error.code).toBe(
      "command_failed",
    );
  });
});
