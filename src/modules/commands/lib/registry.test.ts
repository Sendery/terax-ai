import { describe, expect, it, vi } from "vitest";
import { TAB_COLORS } from "@/modules/tabs";
import {
  COMMAND_IDS,
  PI_ALLOWED_COMMAND_IDS,
  createCommandRegistry,
  describeCommands,
  normalizeCommandError,
  validateCommandRequest,
  type CommandHandlers,
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
  };
}

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
      "sidebar.show",
      "sidebar.hide",
      "tab.openFile",
      "tab.focus",
      "tab.close",
      "tab.rename",
      "tab.resetTitle",
      "tab.setColor",
      "git.diff.open",
      "settings.open",
    ]);
    expect(PI_ALLOWED_COMMAND_IDS).not.toContain("ai.diff.approve");
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
