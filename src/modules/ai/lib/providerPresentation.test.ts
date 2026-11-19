import { describe, expect, it } from "vitest";
import { PROVIDERS, type ProviderId } from "@/modules/ai/config";
import {
  groupProviders,
  PROVIDER_ICONS,
  PROVIDER_ORIGINS,
  providerTitle,
} from "./providerPresentation";

const VENDORS: Partial<Record<ProviderId, string>> = {
  openai: "openai",
  "chatgpt-codex": "openai",
  "cli-codex": "openai",
  anthropic: "anthropic",
  "cli-claude": "anthropic",
};

describe("provider presentation", () => {
  // The complaint this fixes: unrelated providers drawn with the same mark.
  it("never gives two unrelated providers the same icon", () => {
    const seen = new Map<unknown, ProviderId>();
    for (const p of PROVIDERS) {
      const icon = PROVIDER_ICONS[p.id];
      const other = seen.get(icon);
      if (other) {
        expect(VENDORS[other], `${p.id} shares ${other}'s icon`).toBeDefined();
        expect(VENDORS[other]).toBe(VENDORS[p.id]);
      }
      seen.set(icon, p.id);
    }
  });

  it("tells same-vendor providers apart by origin", () => {
    const origins = (["openai", "chatgpt-codex", "cli-codex"] as const).map(
      (id) => PROVIDER_ORIGINS[id],
    );
    expect(new Set(origins).size).toBe(3);
    expect(providerTitle("cli-codex")).toBe("Codex · CLI");
    expect(providerTitle("openai")).toBe("OpenAI · API");
  });

  it("groups by origin, configured first, dropping empty groups", () => {
    const groups = groupProviders(
      [{ id: "cli-pi" }, { id: "openai" }, { id: "cli-agy" }, { id: "anthropic" }] as const,
      (id) => id === "anthropic" || id === "cli-agy",
    );
    expect(groups.map((g) => [g.origin, g.providers.map((p) => p.id)])).toEqual([
      ["api", ["anthropic", "openai"]],
      ["cli", ["cli-agy", "cli-pi"]],
    ]);
  });
});
