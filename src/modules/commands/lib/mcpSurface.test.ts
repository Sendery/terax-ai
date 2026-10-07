import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMcpSurface,
  EXTENSION_TOOL_ALIGNMENT,
  MCP_GROUPS,
} from "./mcpSurface";
import { COMMAND_IDS } from "./registry";

const repoRoot = new URL("../../../../", import.meta.url);
const surface = buildMcpSurface();

describe("MCP surface", () => {
  // The Rust server embeds this file. A registry change that is not
  // regenerated here would ship an MCP server describing the old commands.
  it("matches the manifest the Rust server embeds (pnpm gen:mcp-surface)", async () => {
    await expect(`${JSON.stringify(surface, null, 2)}\n`).toMatchFileSnapshot(
      "../../../../src-tauri/src/modules/mcp/surface.json",
    );
  });

  it("serves every registry command through exactly one action", () => {
    const served = MCP_GROUPS.flatMap((g) =>
      Object.values(g.actions).flatMap((a) => ("command" in a ? [a.command] : [])),
    );
    expect([...served].sort()).toEqual([...COMMAND_IDS].sort());
  });

  it("stays a curated surface, not one tool per command", () => {
    expect(surface.tools.length).toBeGreaterThanOrEqual(5);
    expect(surface.tools.length).toBeLessThanOrEqual(15);
    for (const tool of surface.tools) {
      expect(tool.name).toMatch(/^terax_[a-z_]+$/);
      expect(Object.keys(tool.actions).length).toBeGreaterThan(1);
    }
  });

  it("keeps arguments flat: primitives and enums only", () => {
    for (const tool of surface.tools) {
      for (const [name, prop] of Object.entries(
        tool.inputSchema.properties as Record<string, { type: unknown }>,
      )) {
        const types = ([] as unknown[]).concat(prop.type);
        for (const t of types) {
          expect(["string", "integer", "boolean", "null"], `${tool.name}.${name}`).toContain(t);
        }
      }
    }
  });

  it("only overrides descriptions of arguments a group really has", () => {
    for (const group of MCP_GROUPS) {
      const tool = surface.tools.find((t) => t.name === group.name);
      const props = Object.keys(tool?.inputSchema.properties as object);
      for (const name of Object.keys(group.argDescriptions ?? {})) {
        expect(props, `${group.name}.${name}`).toContain(name);
      }
    }
  });

  it("marks read-only tools honestly", () => {
    const readOnly = surface.tools.filter((t) => t.annotations.readOnlyHint);
    expect(readOnly.map((t) => t.name)).toEqual(["terax_inspect"]);
    for (const t of readOnly) expect(t.annotations.destructiveHint).toBe(false);
  });
});

describe("Pi-Terax extension alignment", () => {
  const extensionSource = readFileSync(
    new URL("packages/pi-terax/src/extension.ts", repoRoot),
    "utf8",
  );
  const extensionTools = [
    ...new Set(
      [...extensionSource.matchAll(/name: "(terax_[a-z_]+)"/g)].map((m) => m[1]),
    ),
  ].sort();

  it("declares how every extension tool is served over MCP", () => {
    expect(extensionTools.length).toBeGreaterThan(0);
    expect(Object.keys(EXTENSION_TOOL_ALIGNMENT).sort()).toEqual(extensionTools);
  });

  it("points every alignment at a real MCP tool and action", () => {
    for (const [name, entry] of Object.entries(EXTENSION_TOOL_ALIGNMENT)) {
      if ("piOnly" in entry) {
        expect(entry.piOnly.length, name).toBeGreaterThan(20);
        continue;
      }
      if (entry.mcp.tool === "*") continue;
      const tool = surface.tools.find((t) => t.name === entry.mcp.tool);
      expect(tool, name).toBeDefined();
      if (entry.mcp.action) expect(tool?.actions[entry.mcp.action], name).toBeDefined();
    }
  });

  it("gives every MCP-only action a Pi counterpart", () => {
    const covered = new Set(
      Object.values(EXTENSION_TOOL_ALIGNMENT).flatMap((e) =>
        "mcp" in e && e.mcp.action ? [`${e.mcp.tool}.${e.mcp.action}`] : [],
      ),
    );
    for (const tool of surface.tools) {
      for (const [action, spec] of Object.entries(tool.actions)) {
        // Registry commands reach Pi through terax_call; local actions need a
        // dedicated extension tool.
        if ("local" in spec) expect(covered, `${tool.name}.${action}`).toContain(`${tool.name}.${action}`);
      }
    }
  });
});
