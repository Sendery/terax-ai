import { describe, expect, it } from "vitest";
import { copilotMcpConfig, copilotPermissionArgs } from "./copilot";

describe("copilotPermissionArgs", () => {
  it("is plan mode plus the read-only Terax tool when read-only", () => {
    expect(copilotPermissionArgs("default", true)).toEqual([
      "--mode",
      "plan",
      "--allow-tool=terax(terax_inspect)",
    ]);
  });

  // Accepting edits withholds the shell, so Terax tools that type into
  // terminals or poll commands stay out too.
  it("allows writes and the Terax tools that cannot run shell input", () => {
    const args = copilotPermissionArgs("acceptEdits", true);
    expect(args[0]).toBe("--allow-tool=write");
    expect(args).toContain("--allow-tool=terax(terax_manage_tabs)");
    expect(args).not.toContain("--allow-tool=terax(terax_terminals)");
    expect(args).not.toContain("--allow-tool=terax(terax_watch)");
    expect(args.some((a) => a.includes("shell"))).toBe(false);
  });

  it("allows everything under full access", () => {
    expect(copilotPermissionArgs("full", true)).toEqual(["--allow-all"]);
  });

  it("adds no Terax rules when the server is not attached", () => {
    expect(copilotPermissionArgs("default", false)).toEqual(["--mode", "plan"]);
  });
});

describe("copilotMcpConfig", () => {
  it("declares the Terax stdio server for one session, pinned to this instance", () => {
    expect(JSON.parse(copilotMcpConfig("/Apps/Terax/terax", "/cache/pi-bridge.json"))).toEqual({
      mcpServers: {
        terax: {
          type: "local",
          command: "/Apps/Terax/terax",
          args: ["--mcp"],
          tools: ["*"],
          env: { TERAX_PI_DISCOVERY: "/cache/pi-bridge.json" },
        },
      },
    });
    expect(JSON.parse(copilotMcpConfig("/t", null)).mcpServers.terax.env).toBeUndefined();
  });
});
