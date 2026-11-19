import { describe, expect, it } from "vitest";
import { MCP_GROUPS } from "@/modules/commands/lib/mcpSurface";
import { agySessionSettings, teraxToolsFor } from "./agy";

describe("Terax tools an agy turn may call", () => {
  it("allows only the read-only tool in the read-only posture", () => {
    expect(teraxToolsFor("default")).toEqual(["terax_inspect"]);
  });

  // Accepting edits withholds the shell; the tools that type into terminals
  // or poll commands would be the way around that.
  it("withholds the shell-capable tools when edits are accepted", () => {
    const tools = teraxToolsFor("acceptEdits");
    expect(tools).toContain("terax_inspect");
    expect(tools).toContain("terax_manage_tabs");
    expect(tools).not.toContain("terax_terminals");
    expect(tools).not.toContain("terax_watch");
    expect(tools.length).toBe(MCP_GROUPS.length - 2);
  });

  it("needs no list under full access", () => {
    expect(teraxToolsFor("full")).toEqual([]);
  });
});

describe("agySessionSettings", () => {
  // agy --settings replaces the user's permissions block for the session,
  // so the user's own rules must be carried over, never dropped.
  it("keeps the user's rules and appends Terax's", () => {
    const settings = agySessionSettings(
      { allow: ["command(ls)"], deny: ["command(rm)"] },
      "default",
    );
    expect(JSON.parse(settings ?? "null")).toEqual({
      permissions: {
        allow: ["command(ls)", "mcp(terax/terax_inspect)"],
        deny: ["command(rm)"],
      },
    });
  });

  it("does not duplicate a rule the user already has", () => {
    const settings = agySessionSettings({ allow: ["mcp(terax/terax_inspect)"] }, "default");
    expect(JSON.parse(settings ?? "null").permissions.allow).toEqual([
      "mcp(terax/terax_inspect)",
    ]);
  });

  it("works when agy has no rules yet", () => {
    expect(JSON.parse(agySessionSettings({}, "default") ?? "null")).toEqual({
      permissions: { allow: ["mcp(terax/terax_inspect)"] },
    });
  });

  it("passes nothing when the user's rules could not be read", () => {
    expect(agySessionSettings(null, "acceptEdits")).toBeNull();
    expect(agySessionSettings(undefined, "default")).toBeNull();
  });

  it("passes nothing under full access", () => {
    expect(agySessionSettings({ allow: [] }, "full")).toBeNull();
  });
});
