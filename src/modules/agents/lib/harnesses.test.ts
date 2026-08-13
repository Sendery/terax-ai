import { describe, expect, it } from "vitest";
import { integrationForAgent } from "./harnesses";

describe("integrationForAgent", () => {
  it("marks Pi as a first-party extension", () => {
    expect(integrationForAgent("pi")).toEqual({
      harness: "pi",
      integration: "pi-extension",
      authority: "Pi extension",
      lifecycle: "native",
    });
  });

  it("marks Claude as a native hook integration", () => {
    expect(integrationForAgent("claude")).toEqual({
      harness: "claude",
      integration: "claude-hook",
      authority: "Native hook",
      lifecycle: "native",
    });
  });

  it("keeps Codex as validated PTY lifecycle detection, not a native hook", () => {
    expect(integrationForAgent("codex")).toEqual({
      harness: "codex",
      integration: "pty-detection",
      authority: "PTY detection",
      lifecycle: "detected",
    });
  });
});
