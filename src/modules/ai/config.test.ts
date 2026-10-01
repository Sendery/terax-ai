import { describe, expect, it } from "vitest";
import {
  MODELS,
  MODEL_CONTEXT_LIMITS,
  isCliProvider,
  compatModelIdForEndpoint,
  endpointIdFromCompatModel,
  getModelContextLimit,
  isCompatModelId,
  migrateLegacyCompatEndpoint,
  modelKeepsReasoning,
  oauthProviderFor,
  providerNeedsKey,
  providerRequiresOAuth,
  resolveModel,
  type CustomEndpoint,
} from "./config";

const endpoint: CustomEndpoint = {
  id: "ab12cd34",
  name: "My LLM",
  baseURL: "https://api.example.com/v1",
  modelId: "llama-3.3-70b",
  contextLimit: 64_000,
};

describe("compat model id helpers", () => {
  it("round-trips endpoint id through the synthetic model id", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(isCompatModelId(mid)).toBe(true);
    expect(endpointIdFromCompatModel(mid)).toBe(endpoint.id);
  });

  it("treats static model ids as non-compat", () => {
    expect(isCompatModelId("gpt-5.4-mini")).toBe(false);
    expect(endpointIdFromCompatModel("gpt-5.4-mini")).toBe("");
  });
});

describe("resolveModel", () => {
  it("resolves a compat model id against its endpoint", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    const info = resolveModel(mid, [endpoint]);
    expect(info.provider).toBe("openai-compatible");
    expect(info.id).toBe(mid);
    expect(info.label).toBe(endpoint.modelId);
  });

  it("falls back to a placeholder when the endpoint is gone", () => {
    const info = resolveModel(compatModelIdForEndpoint("missing"), []);
    expect(info.provider).toBe("openai-compatible");
  });

  it("resolves a static model id from the registry", () => {
    expect(resolveModel("gpt-5.4-mini").provider).toBe("openai");
  });

  it("throws on an unknown static model id", () => {
    expect(() => resolveModel("nope-not-real")).toThrow();
  });
});

describe("getModelContextLimit", () => {
  it("uses the per-endpoint override for compat models", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(getModelContextLimit(mid, endpoint.contextLimit)).toBe(64_000);
  });

  it("reads the static table for known models", () => {
    expect(getModelContextLimit("claude-opus-4-7")).toBe(200_000);
  });
});

describe("modelKeepsReasoning", () => {
  it("keeps reasoning for compat endpoints (freeform provider)", () => {
    const info = resolveModel(compatModelIdForEndpoint(endpoint.id), [endpoint]);
    expect(modelKeepsReasoning(info)).toBe(true);
  });

  it("drops reasoning for plain non-reasoning models", () => {
    expect(modelKeepsReasoning(resolveModel("gpt-5.4-mini"))).toBe(false);
  });

  it("keeps reasoning for tagged reasoning models", () => {
    expect(modelKeepsReasoning(resolveModel("claude-opus-4-7"))).toBe(true);
  });
});

describe("migrateLegacyCompatEndpoint", () => {
  it("migrates a fully configured legacy endpoint", () => {
    const out = migrateLegacyCompatEndpoint(
      "https://api.example.com/v1",
      "llama-3.3-70b",
      32_000,
      "fixedid1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "fixedid1",
      baseURL: "https://api.example.com/v1",
      modelId: "llama-3.3-70b",
      contextLimit: 32_000,
    });
  });

  it("skips migration when base URL or model id is missing", () => {
    expect(migrateLegacyCompatEndpoint("", "m", 1, "x")).toEqual([]);
    expect(migrateLegacyCompatEndpoint("u", "  ", 1, "x")).toEqual([]);
  });
});

describe("subscription sign-in providers", () => {
  it("maps each Terax provider to the backend login that authorises it", () => {
    expect(oauthProviderFor("anthropic")).toBe("anthropic");
    expect(oauthProviderFor("chatgpt-codex")).toBe("openai-codex");
  });

  it("leaves key-only providers without a login", () => {
    expect(oauthProviderFor("openai")).toBeNull();
    expect(oauthProviderFor("google")).toBeNull();
  });

  it("does not demand an API key for the ChatGPT subscription", () => {
    // There is no key to demand: the plan is only reachable through OAuth, so
    // requiring one would make the provider permanently unusable.
    expect(providerNeedsKey("chatgpt-codex")).toBe(false);
    expect(providerRequiresOAuth("chatgpt-codex")).toBe(true);
  });

  it("keeps Anthropic usable with either credential", () => {
    expect(providerNeedsKey("anthropic")).toBe(true);
    expect(providerRequiresOAuth("anthropic")).toBe(false);
  });

  it("gives the subscription copies of OpenAI models their own ids", () => {
    // The catalogue is keyed by id, and these reach the same models through a
    // different account, so they cannot reuse the API-key model ids.
    const codex = MODELS.filter((m) => m.provider === "chatgpt-codex");
    expect(codex.length).toBeGreaterThan(0);
    for (const model of codex) {
      expect(model.id.startsWith("codex-")).toBe(true);
      expect(resolveModel(model.id).provider).toBe("chatgpt-codex");
    }
  });

  it("keeps every catalogue model id unique", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("model catalogue currency", () => {
  it("offers the current frontier model of each major provider", () => {
    // The catalogue is hand-maintained, so a model that shipped after the last
    // edit is simply missing and nothing else notices.
    const ids = new Set(MODELS.map((m) => m.id));
    expect(ids).toContain("gpt-6-astra");
    expect(ids).toContain("claude-opus-5-5");
    expect(ids).toContain("claude-fable-5-1");
    expect(ids).toContain("gemini-3.8-flash");
  });

  it("gives every model a context window except the CLI agents", () => {
    // A CLI agent manages its own context, so it has no window to report.
    // For everything else a missing entry silently falls back to 128K, which
    // makes the usage indicator wrong rather than absent.
    const missing = MODELS.filter(
      (m) => !isCliProvider(m.provider) && !(m.id in MODEL_CONTEXT_LIMITS),
    ).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it("reports the million-token windows of the newest models", () => {
    expect(getModelContextLimit("claude-opus-5-5")).toBe(1_000_000);
    expect(getModelContextLimit("gpt-6-astra")).toBe(1_000_000);
  });
});
