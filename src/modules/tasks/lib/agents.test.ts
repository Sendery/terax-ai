import { describe, expect, it } from "vitest";

import {
  agentCapabilities,
  agentLabel,
  agentModelPresets,
  DEFAULT_TASK_AGENT,
  isTaskAgent,
  newSessionSeed,
  TASK_AGENTS,
} from "./agents";

describe("task agents", () => {
  it("exposes the three supported agent CLIs", () => {
    expect([...TASK_AGENTS]).toEqual(["pi", "claude", "codex"]);
    expect(DEFAULT_TASK_AGENT).toBe("pi");
  });

  it("validates untrusted agent values", () => {
    for (const agent of TASK_AGENTS) expect(isTaskAgent(agent)).toBe(true);
    for (const bad of ["", "gemini", 3, null, undefined, {}]) {
      expect(isTaskAgent(bad)).toBe(false);
    }
  });

  it("labels every agent", () => {
    expect(agentLabel("pi")).toBe("Pi");
    expect(agentLabel("claude")).toBe("Claude Code");
    expect(agentLabel("codex")).toBe("Codex");
  });

  it("describes which options each CLI actually accepts", () => {
    expect(agentCapabilities("pi")).toEqual({
      binary: "pi",
      provider: true,
      thinking: true,
      session: "arbitrary",
    });
    expect(agentCapabilities("claude").session).toBe("uuid");
    expect(agentCapabilities("claude").provider).toBe(false);
    expect(agentCapabilities("codex").session).toBe("none");
    expect(agentCapabilities("codex").thinking).toBe(false);
  });

  it("offers model presets per agent", () => {
    for (const agent of TASK_AGENTS) {
      const presets = agentModelPresets(agent);
      expect(presets.length).toBeGreaterThan(0);
      // Presets are values passed verbatim to the CLI, never empty.
      expect(presets.every((preset) => preset.value.trim() !== "")).toBe(true);
    }
    expect(agentModelPresets("claude").map((p) => p.value)).toContain("sonnet");
  });

  it("qualifies pi presets by provider, since a bare pattern can be ambiguous", () => {
    // pi rejects a --model pattern several configured providers can satisfy,
    // so an unqualified preset would fail every run on a multi provider setup.
    for (const preset of agentModelPresets("pi")) {
      expect(preset.value).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
    }
  });

  it("mints a UUID session seed so every agent can accept it", () => {
    const seed = newSessionSeed();
    expect(seed).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(newSessionSeed()).not.toBe(seed);
  });
});
