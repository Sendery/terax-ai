import { describe, expect, it } from "vitest";

import { agentKindFromName } from "./agentKind";

describe("agentKindFromName", () => {
  it("recognises the two agents that persist a transcript", () => {
    expect(agentKindFromName("pi")).toBe("pi");
    expect(agentKindFromName("claude")).toBe("claude");
    expect(agentKindFromName("claude-code")).toBe("claude");
    expect(agentKindFromName("Claude")).toBe("claude");
  });

  it("reports no history for agents that keep none", () => {
    // Detection reports free-form names; anything unknown must not be shown an
    // empty graph as if it had no history.
    for (const other of ["codex", "gemini", "aider", "copilot", "", null, undefined]) {
      expect(agentKindFromName(other)).toBe(null);
    }
  });

  it("does not match an unrelated name that merely contains the letters", () => {
    expect(agentKindFromName("copilot")).toBe(null);
    expect(agentKindFromName("pipenv")).toBe(null);
  });
});
