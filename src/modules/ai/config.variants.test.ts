import { describe, expect, it } from "vitest";
import {
  getModel,
  getModelContextLimit,
  MODEL_CONTEXT_LIMITS,
  isKnownModelId,
  parseVariantModelId,
  rememberVariantLabel,
  resolveModel,
  variantModelId,
  variantWireModel,
} from "./config";

describe("catalogue variant model ids", () => {
  it("round-trips a provider and the provider's own model name", () => {
    const id = variantModelId("openrouter", "anthropic/claude-sonnet-5:beta");
    expect(parseVariantModelId(id)).toEqual({ provider: "openrouter", wire: "anthropic/claude-sonnet-5:beta" });
    expect(variantWireModel(id)).toBe("anthropic/claude-sonnet-5:beta");
  });

  it("rejects ids that are not variants or carry unsafe names", () => {
    for (const id of ["gpt-5.5", "::x", "nope::x", "lmstudio::x", "openai::", "openai::a b", "openai::--flag", "openai::a;rm"]) {
      expect(parseVariantModelId(id), id).toBeNull();
    }
  });

  it("resolves through the same lookups as built-in models", () => {
    const id = "cli-agy::gemini-3.8-flash-high";
    expect(isKnownModelId(id)).toBe(true);
    expect(getModel(id).provider).toBe("cli-agy");
    expect(resolveModel(id).label).toBe("gemini-3.8-flash-high");
    rememberVariantLabel(id, "Gemini 3.8 Flash (High)");
    expect(resolveModel(id).label).toBe("Gemini 3.8 Flash (High)");
    expect(resolveModel("openai::gpt-7").capabilities).toEqual({ intelligence: 3, speed: 3, cost: 3 });
  });

  it("still resolves built-in ids and rejects unknown ones", () => {
    expect(resolveModel("gpt-5.5").id).toBe("gpt-5.5");
    expect(() => resolveModel("not-a-model")).toThrow();
    expect(isKnownModelId("not-a-model")).toBe(false);
  });
});

describe("variant context limits", () => {
  it("uses the provider model's own limit when it is known", () => {
    const known = Object.keys(MODEL_CONTEXT_LIMITS)[0];
    expect(getModelContextLimit(`openrouter::${known}`)).toBe(MODEL_CONTEXT_LIMITS[known]);
    expect(getModelContextLimit("openai::gpt-unknown-9")).toBe(128_000);
  });
});
