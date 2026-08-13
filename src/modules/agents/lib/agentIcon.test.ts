import { describe, expect, it } from "vitest";
import { ChatGptIcon, ClaudeIcon, PiIcon, RoboticIcon } from "@hugeicons/core-free-icons";
import { iconForHarness } from "./agentIcon";

describe("iconForHarness", () => {
  it("uses the explicit harness identity instead of the display label", () => {
    expect(iconForHarness("pi")).toBe(PiIcon);
    expect(iconForHarness("claude")).toBe(ClaudeIcon);
    expect(iconForHarness("codex")).toBe(ChatGptIcon);
    expect(iconForHarness("generic")).toBe(RoboticIcon);
  });
});
