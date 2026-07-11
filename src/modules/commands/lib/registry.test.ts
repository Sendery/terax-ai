import { describe, expect, it, vi } from "vitest";
import {
  PI_ALLOWED_COMMAND_IDS,
  createCommandRegistry,
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
  };
}

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
    expect(validateCommandRequest({ id: "app.snapshot", payload: null })).toEqual({
      ok: true,
      value: { id: "app.snapshot" },
    });
    expect(validateCommandRequest({ id: "sidebar.show", payload: null })).toEqual({
      ok: true,
      value: { id: "sidebar.show", payload: { view: undefined } },
    });
    expect(validateCommandRequest({ id: "settings.open", payload: null })).toEqual({
      ok: true,
      value: { id: "settings.open", payload: { tab: undefined } },
    });
  });

  it("validates payloads for known commands", () => {
    expect(validateCommandRequest({ id: "tab.openFile", payload: {} })).toEqual({
      ok: false,
      error: {
        code: "invalid_payload",
        message: "tab.openFile requires payload.path",
      },
    });

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
      "sidebar.show",
      "sidebar.hide",
      "tab.openFile",
      "tab.focus",
      "tab.close",
      "tab.rename",
      "tab.resetTitle",
      "git.diff.open",
      "settings.open",
    ]);
    expect(PI_ALLOWED_COMMAND_IDS).not.toContain("ai.diff.approve");
  });
});
