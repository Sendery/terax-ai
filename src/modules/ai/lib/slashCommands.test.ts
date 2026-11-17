import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS, tryRunSlashCommand } from "./slashCommands";

describe("conversation commands", () => {
  it("starts a new conversation, carrying any text as its first message", () => {
    expect(tryRunSlashCommand("/new")).toEqual({ kind: "new-session", prompt: null });
    expect(tryRunSlashCommand("#new fix the build")).toEqual({
      kind: "new-session",
      prompt: "fix the build",
    });
  });

  it("compacts, with an optional focus", () => {
    expect(tryRunSlashCommand("/compact")).toEqual({ kind: "compact", focus: "" });
    expect(tryRunSlashCommand("#compact keep the file paths")).toEqual({
      kind: "compact",
      focus: "keep the file paths",
    });
  });

  it("offers both in the snippet picker", () => {
    expect(SLASH_COMMANDS.new.invocation).toBe("/new");
    expect(SLASH_COMMANDS.compact.invocation).toBe("/compact");
  });

  it("leaves a user snippet with another handle alone", () => {
    expect(tryRunSlashCommand("#newsletter draft")).toEqual({ kind: "none" });
  });
});
