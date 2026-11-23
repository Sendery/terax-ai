import { describe, expect, it, vi } from "vitest";
import type { Tab } from "@/modules/tabs";
import {
  createTerminalControl,
  listTerminalPanes,
  type TerminalControlDeps,
} from "./terminalControl";

function terminal(id: number, leafId: number, extra: Record<string, unknown> = {}): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    cwd: `/work/${id}`,
    paneTree: { kind: "leaf", id: leafId, cwd: `/work/${id}` },
    activeLeafId: leafId,
    ...extra,
  } as Tab;
}

function setup(tabs: Tab[], overrides: Partial<TerminalControlDeps> = {}) {
  const state = { tabs };
  const deps: TerminalControlDeps = {
    getTabs: () => state.tabs,
    getActiveTabId: () => state.tabs[0]?.id ?? null,
    getAgent: () => undefined,
    readBuffer: vi.fn(async () => "one\ntwo\nthree"),
    isMounted: () => true,
    newTab: vi.fn((cwd?: string) => {
      state.tabs = [...state.tabs, terminal(90, 91, { cwd })];
      return 90;
    }),
    defaultCwd: () => "/default",
    focusTab: vi.fn(),
    focusPane: vi.fn(),
    splitActivePane: vi.fn(() => null),
    closePane: vi.fn(),
    setTabTitle: vi.fn(),
    whenReady: vi.fn(async () => {}),
    write: vi.fn(() => true),
    focusInput: vi.fn(),
    maxPanesPerTab: 4,
    ...overrides,
  };
  return { deps, control: createTerminalControl(deps), state };
}

const SECRET = terminal(5, 6, { private: true, title: "prod ssh", cwd: "/secret" });

describe("listTerminalPanes", () => {
  it("counts private terminals and says nothing else about them", () => {
    const out = listTerminalPanes([terminal(1, 2), SECRET], 1, {
      getAgent: () => undefined,
      isMounted: () => true,
    });
    expect(out.privateTerminals).toBe(1);
    expect(out.panes.map((p) => p.leafId)).toEqual([2]);
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(JSON.stringify(out)).not.toContain("prod ssh");
  });

  it("reports focus, custom titles, the running agent and unstarted panes", () => {
    const out = listTerminalPanes(
      [terminal(1, 2, { customTitle: "api" }), terminal(3, 4, { cold: true })],
      1,
      {
        getAgent: (leafId) => (leafId === 2 ? { agent: "claude", status: "working" } : undefined),
        isMounted: (leafId) => leafId === 2,
      },
    );
    expect(out.panes[0]).toMatchObject({
      leafId: 2,
      title: "api",
      focused: true,
      started: true,
      agent: { name: "claude", status: "working" },
    });
    expect(out.panes[1]).toMatchObject({ leafId: 4, focused: false, started: false });
  });
});

describe("terminal control", () => {
  // The privacy boundary: no command reaches a private pane, whatever it does.
  it("refuses every operation on a private terminal", async () => {
    const { control, deps } = setup([terminal(1, 2), SECRET]);
    const attempts = [
      () => control.readTerminal({ leafId: 6 }),
      () => control.sendToTerminal({ leafId: 6, text: "env" }),
      () => control.focusTerminal({ leafId: 6 }),
      () => control.closeTerminal({ leafId: 6 }),
      () => control.splitTerminal({ leafId: 6, direction: "right" }),
    ];
    for (const attempt of attempts) {
      await expect(Promise.resolve().then(attempt)).rejects.toMatchObject({
        code: "command_failed",
        message: expect.stringContaining("private"),
      });
    }
    expect(deps.readBuffer).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
    expect(deps.closePane).not.toHaveBeenCalled();
  });

  it("returns the requested tail of a pane", async () => {
    const { control } = setup([terminal(1, 2)]);
    expect(await control.readTerminal({ leafId: 2, lines: 2 })).toEqual({
      leafId: 2,
      tabId: 1,
      text: "two\nthree",
      lines: 2,
      truncated: true,
    });
  });

  it("fails rather than returning nothing when the buffer is withheld", async () => {
    const { control } = setup([terminal(1, 2)], { readBuffer: async () => null });
    await expect(control.readTerminal({ leafId: 2 })).rejects.toMatchObject({
      code: "command_failed",
    });
  });

  it("does not read or type into a pane that has not started", async () => {
    const { control, deps } = setup([terminal(1, 2, { cold: true })]);
    await expect(control.readTerminal({ leafId: 2 })).rejects.toMatchObject({
      message: expect.stringContaining("not started"),
    });
    await expect(control.sendToTerminal({ leafId: 2, text: "ls" })).rejects.toMatchObject({
      message: expect.stringContaining("not started"),
    });
    expect(deps.write).not.toHaveBeenCalled();
  });

  it("opens a terminal, titles it and runs the command once the shell is ready", async () => {
    const { control, deps } = setup([terminal(1, 2)]);
    const out = await control.openTerminal({ command: "pnpm test", title: " tests " });
    expect(deps.newTab).toHaveBeenCalledWith("/default");
    expect(deps.setTabTitle).toHaveBeenCalledWith(90, "tests");
    expect(deps.whenReady).toHaveBeenCalledWith(91);
    expect(deps.write).toHaveBeenCalledWith(91, "pnpm test\r");
    expect(out).toEqual({ tabId: 90, leafId: 91, commandSent: true });
  });

  it("types without submitting when asked to", async () => {
    const { control, deps } = setup([terminal(1, 2)]);
    await control.sendToTerminal({ leafId: 2, text: "git push", submit: false });
    expect(deps.write).toHaveBeenCalledWith(2, "git push");
    await control.sendToTerminal({ leafId: 2, text: "git status" });
    expect(deps.write).toHaveBeenLastCalledWith(2, "git status\r");
  });

  it("records explicit public endpoints only after a successful write", async () => {
    const onDelivery = vi.fn();
    const { control, deps, state } = setup([terminal(1, 2), terminal(3, 4), SECRET], { onDelivery });
    await control.sendToTerminal({ leafId: 4, sourceLeafId: 2, text: "fixture", submit: false });
    expect(onDelivery).toHaveBeenCalledWith({ tabId: 3, leafId: 4 }, { tabId: 1, leafId: 2 }, false);
    await expect(control.sendToTerminal({ leafId: 4, sourceLeafId: 6, text: "fixture" })).rejects.toMatchObject({
      code: "command_failed",
    });
    expect(deps.write).toHaveBeenCalledTimes(1);
    const delayed = control.sendToTerminal({ leafId: 4, sourceLeafId: 2, text: "fixture" });
    state.tabs[1] = terminal(3, 4, { private: true });
    await expect(delayed).rejects.toMatchObject({ code: "command_failed" });
    expect(onDelivery).toHaveBeenCalledTimes(1);
  });

  it("keeps the last terminal open", () => {
    const { control, deps } = setup([terminal(1, 2)]);
    expect(() => control.closeTerminal({ leafId: 2 })).toThrow();
    expect(deps.closePane).not.toHaveBeenCalled();
  });

  it("closes a pane and reports whether its tab went with it", () => {
    const { control, deps } = setup([terminal(1, 2), terminal(3, 4)]);
    expect(control.closeTerminal({ leafId: 4 })).toEqual({ closed: 4, tabClosed: true });
    expect(deps.closePane).toHaveBeenCalledWith(4);
  });

  it("reports an unknown pane", () => {
    const { control } = setup([terminal(1, 2)]);
    expect(() => control.focusTerminal({ leafId: 99 })).toThrow();
  });
});
