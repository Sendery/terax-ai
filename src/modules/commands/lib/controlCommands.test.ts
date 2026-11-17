import { describe, expect, it, vi } from "vitest";
import {
  CONTROL_COMMAND_IDS,
  type ControlHandlers,
  dispatchControlCommand,
  validateControlPayload,
} from "./controlCommands";
import { describeCommands, validateCommandRequest } from "./registry";

function handlers(): ControlHandlers {
  return {
    listTerminals: vi.fn(() => "listTerminals"),
    readTerminal: vi.fn(() => "readTerminal"),
    openTerminal: vi.fn(() => "openTerminal"),
    splitTerminal: vi.fn(() => "splitTerminal"),
    focusTerminal: vi.fn(() => "focusTerminal"),
    closeTerminal: vi.fn(() => "closeTerminal"),
    sendToTerminal: vi.fn(() => "sendToTerminal"),
    listSpaces: vi.fn(() => "listSpaces"),
    focusSpace: vi.fn(() => "focusSpace"),
    moveTabToSpace: vi.fn(() => "moveTabToSpace"),
    listWatches: vi.fn(() => "listWatches"),
    readWatch: vi.fn(() => "readWatch"),
    addWatch: vi.fn(() => "addWatch"),
    updateWatch: vi.fn(() => "updateWatch"),
    removeWatch: vi.fn(() => "removeWatch"),
    setWatchEnabled: vi.fn(() => "setWatchEnabled"),
    runWatch: vi.fn(() => "runWatch"),
  };
}

describe("control command validation", () => {
  it("accepts a well-formed payload and keeps only declared fields", () => {
    expect(validateControlPayload("terminal.read", { leafId: 4, lines: 50 })).toEqual({
      ok: true,
      value: { leafId: 4, lines: 50 },
    });
  });

  it("refuses unknown fields instead of ignoring them", () => {
    const result = validateControlPayload("terminal.read", { leafId: 4, line: 50 });
    expect(result).toEqual({ ok: false, message: 'terminal.read does not accept "line"' });
  });

  it("refuses a payload on commands that take none", () => {
    expect(validateControlPayload("terminal.list", undefined).ok).toBe(true);
    expect(validateControlPayload("terminal.list", {}).ok).toBe(false);
  });

  it("lets a command with only optional fields run without a payload", () => {
    expect(validateControlPayload("terminal.open", undefined)).toEqual({ ok: true, value: {} });
  });

  it("enforces required fields, types, enums and ranges", () => {
    expect(validateControlPayload("terminal.read", {}).ok).toBe(false);
    expect(validateControlPayload("terminal.read", { leafId: "4" }).ok).toBe(false);
    expect(validateControlPayload("terminal.read", { leafId: 4, lines: 0 }).ok).toBe(false);
    expect(validateControlPayload("terminal.read", { leafId: 4, lines: 2001 }).ok).toBe(false);
    expect(validateControlPayload("terminal.split", { leafId: 4, direction: "left" }).ok).toBe(false);
    expect(validateControlPayload("terminal.split", { leafId: 4, direction: "down" }).ok).toBe(true);
    expect(validateControlPayload("watch.setEnabled", { id: "w", enabled: "yes" }).ok).toBe(false);
  });

  it("bounds how often a watch may poll", () => {
    const base = { name: "pr", command: "gh pr view 1" };
    expect(validateControlPayload("watch.add", { ...base, intervalSeconds: 14 }).ok).toBe(false);
    expect(validateControlPayload("watch.add", { ...base, intervalSeconds: 15 }).ok).toBe(true);
    expect(validateControlPayload("watch.add", { ...base, intervalSeconds: 86_401 }).ok).toBe(false);
  });

  // Anything typed into a terminal or handed to a shell is one line: a
  // newline would smuggle a second command past whoever approved the first.
  it("refuses control bytes and deny-listed forms in shell input", () => {
    expect(validateControlPayload("terminal.send", { leafId: 1, text: "ls\nrm -rf ~" }).ok).toBe(false);
    expect(validateControlPayload("terminal.send", { leafId: 1, text: "ls\u001b[A" }).ok).toBe(false);
    expect(validateControlPayload("terminal.send", { leafId: 1, text: "rm -rf /" }).ok).toBe(false);
    expect(validateControlPayload("terminal.open", { command: "echo a\necho b" }).ok).toBe(false);
    expect(
      validateControlPayload("watch.add", { name: "x", command: "rm -rf /", intervalSeconds: 60 }).ok,
    ).toBe(false);
    expect(validateControlPayload("terminal.send", { leafId: 1, text: "pnpm test" }).ok).toBe(true);
  });

  it("requires an edit to actually change something", () => {
    expect(validateControlPayload("watch.update", { id: "w" }).ok).toBe(false);
    expect(validateControlPayload("watch.update", { id: "w", intervalSeconds: 60 }).ok).toBe(true);
  });
});

describe("control commands in the registry", () => {
  it("publishes every control command in the catalog with its arguments", () => {
    const catalog = new Map(describeCommands().commands.map((c) => [c.id, c]));
    for (const id of CONTROL_COMMAND_IDS) {
      expect(catalog.get(id)?.description.length, id).toBeGreaterThan(10);
    }
    expect(catalog.get("terminal.split")?.params.map((p) => p.name)).toEqual([
      "leafId",
      "direction",
      "command",
    ]);
    // Validator-only limits stay out of the public shape.
    expect(Object.keys(catalog.get("terminal.read")?.params[1] ?? {}).sort()).toEqual([
      "description",
      "name",
      "required",
      "type",
    ]);
  });

  it("validates through the shared entry point", () => {
    expect(validateCommandRequest({ id: "terminal.focus", payload: { leafId: 3 } })).toEqual({
      ok: true,
      value: { id: "terminal.focus", payload: { leafId: 3 } },
    });
    expect(validateCommandRequest({ id: "terminal.focus", payload: {} })).toMatchObject({
      ok: false,
      error: { code: "invalid_payload" },
    });
  });

  it("routes every control command to its own handler", () => {
    const h = handlers();
    const seen = CONTROL_COMMAND_IDS.map((id) => dispatchControlCommand(h, id, {}));
    expect(new Set(seen).size).toBe(CONTROL_COMMAND_IDS.length);
    for (const fn of Object.values(h)) expect(fn).toHaveBeenCalledTimes(1);
  });
});
