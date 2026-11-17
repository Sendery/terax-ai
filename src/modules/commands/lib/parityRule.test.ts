import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PI_TERAX_MANAGER_INSTRUCTIONS } from "@/modules/ai/lib/piTeraxManager";
import { commandNamespaces, describeCapabilities } from "./capabilities";
import { MCP_GROUPS } from "./mcpSurface";
import { COMMAND_POLICY, SHELL_COMMAND_IDS } from "./policy";
import { COMMAND_IDS, type CommandId } from "./registry";

const repoRoot = new URL("../../../../", import.meta.url);

function groupOf(id: CommandId) {
  const group = MCP_GROUPS.find((g) =>
    Object.values(g.actions).some((a) => "command" in a && a.command === id),
  );
  if (!group) throw new Error(`${id} is not served over MCP`);
  return group;
}

/**
 * The capability parity rule (TERAX.md, "Capability parity"): a feature an
 * agent can use exists in the registry, the MCP surface, the Pi-Terax
 * extension and the Pi-Terax Agente's own instructions, or in none of them.
 * allowlistParity.test.ts and mcpSurface.test.ts hold the id lists together;
 * these hold the meaning together.
 */
describe("capability parity rule", () => {
  it("classifies every command and nothing else", () => {
    expect(Object.keys(COMMAND_POLICY).sort()).toEqual([...COMMAND_IDS].sort());
  });

  it("serves read commands, and only those, from the read-only MCP tool", () => {
    for (const id of COMMAND_IDS) {
      const readOnly = groupOf(id).annotations.readOnlyHint;
      expect(readOnly, id).toBe(COMMAND_POLICY[id] === "read");
    }
  });

  it("marks the MCP tool of every approval-gated command as destructive", () => {
    for (const id of COMMAND_IDS) {
      if (COMMAND_POLICY[id] !== "approve") continue;
      // Speech keeps its installs beside playback; they fetch, not destroy.
      if (id.startsWith("tts.")) continue;
      expect(groupOf(id).annotations.destructiveHint, id).toBe(true);
    }
  });

  it("gates every shell-capable command behind approval and an open-world tool", () => {
    for (const id of SHELL_COMMAND_IDS) {
      expect(COMMAND_POLICY[id], id).toBe("approve");
      expect(groupOf(id).annotations.openWorldHint, id).toBe(true);
    }
  });

  it("gives the extension the same shell-capable list, behind terax_run", () => {
    const source = readFileSync(
      new URL("packages/pi-terax/src/commands.ts", repoRoot),
      "utf8",
    );
    const start = source.indexOf("export const TERAX_SHELL_COMMAND_IDS");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("] as const", start));
    const ids = (block.match(/"[a-z][a-zA-Z-]*(?:\.[a-zA-Z]+)+"/g) ?? []).map((id) =>
      id.slice(1, -1),
    );
    expect(ids).toEqual([...SHELL_COMMAND_IDS]);
  });

  it("keeps the Pi chat posture without a shell away from terax_run", () => {
    const source = readFileSync(new URL("src/modules/ai/cli/pi.ts", repoRoot), "utf8");
    expect(source).toMatch(/acceptEdits: \[[^\]]*"terax_run"/);
    const readOnly = source.slice(
      source.indexOf("export const PI_READ_ONLY_TOOLS"),
      source.indexOf("];", source.indexOf("export const PI_READ_ONLY_TOOLS")),
    );
    expect(readOnly).not.toContain("terax_run");
    expect(readOnly).not.toContain("terax_call");
  });

  // The agent learns what exists from the catalog, but it is told what to
  // reach for here. A new area nobody described is an area it never uses.
  it("describes every command area in the Pi-Terax Agente instructions", () => {
    for (const namespace of commandNamespaces()) {
      expect(PI_TERAX_MANAGER_INSTRUCTIONS, namespace).toContain(`${namespace}.`);
    }
  });

  it("builds the built-in agent's tool description from every command", () => {
    const text = describeCapabilities();
    for (const id of COMMAND_IDS) expect(text, id).toContain(id);
    expect(text).toContain("terminal.send*");
    expect(text).not.toContain("terminal.read*");
  });

  it("states the rule where contributors and agents read it", () => {
    for (const path of ["TERAX.md", "AGENTS.md"]) {
      const doc = readFileSync(new URL(path, repoRoot), "utf8");
      expect(doc, path).toContain("Capability parity");
    }
  });
});
