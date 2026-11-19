import { describe, expect, it } from "vitest";
import { parseVariantModelId, resolveModel } from "@/modules/ai/config";
import {
  CATALOG_SOURCES,
  parseAgyModels,
  parseApiModels,
  parseOpencodeModels,
  reconcileCatalog,
} from "./modelCatalog";

describe("CLI catalogue parsers", () => {
  it("reads agy models as printed by agy 1.5.12", () => {
    expect(
      parseAgyModels([
        "Fetching available models...",
        "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
        "claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)",
        "",
        "bad id\tNope",
      ]),
    ).toEqual([
      { wire: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
      { wire: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)" },
    ]);
  });

  it("reads opencode models and skips noise", () => {
    expect(parseOpencodeModels(["anthropic/claude-sonnet-5", "Loading…", "  "])).toEqual([
      { wire: "anthropic/claude-sonnet-5", label: "anthropic/claude-sonnet-5" },
    ]);
  });
});

describe("parseApiModels", () => {
  it("keeps chat models from an OpenAI-style list", () => {
    const json = {
      data: [
        { id: "gpt-6-astra" },
        { id: "text-embedding-3-large" },
        { id: "gpt-image-2" },
        { id: "whisper-2" },
        { id: "gpt-6-astra" },
      ],
    };
    expect(parseApiModels("openai", json).map((m) => m.wire)).toEqual(["gpt-6-astra"]);
  });

  it("uses Anthropic's display names", () => {
    expect(
      parseApiModels("anthropic", { data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }] }),
    ).toEqual([{ wire: "claude-opus-5-5", label: "Claude Opus 5.5" }]);
  });

  it("keeps only Gemini models that generate content", () => {
    const json = {
      models: [
        { name: "models/gemini-3.8-pro", displayName: "Gemini 3.8 Pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-005", supportedGenerationMethods: ["embedContent"] },
      ],
    };
    expect(parseApiModels("google", json)).toEqual([{ wire: "gemini-3.8-pro", label: "Gemini 3.8 Pro" }]);
  });

  it("returns nothing for a reply it does not understand", () => {
    expect(parseApiModels("openai", { error: "nope" })).toEqual([]);
    expect(parseApiModels("openai", null)).toEqual([]);
  });
});

describe("reconcileCatalog", () => {
  it("keeps built-in API models as they are and adds the rest as variants", () => {
    const view = reconcileCatalog(
      "openai",
      [
        { wire: "gpt-5.5", label: "GPT-5.5" },
        { wire: "gpt-7-preview", label: "gpt-7-preview" },
      ],
      true,
    );
    expect(view.extra).toEqual([
      { id: "openai::gpt-7-preview", wire: "gpt-7-preview", label: "gpt-7-preview" },
    ]);
    expect(view.unlisted.has("gpt-5.5")).toBe(false);
    expect(view.unlisted.has("gpt-6-astra")).toBe(true);
  });

  it("never marks models unlisted from a static or empty catalogue", () => {
    expect(reconcileCatalog("openai", [], true).unlisted.size).toBe(0);
    expect(reconcileCatalog("openai", [{ wire: "gpt-5.5", label: "x" }], false).unlisted.size).toBe(0);
  });

  // Each CLI model is its own entry, so it can be starred and picked directly.
  it("turns every CLI model into a selectable variant of that CLI", () => {
    const view = reconcileCatalog("cli-agy", [{ wire: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" }], true);
    expect(view.extra[0].id).toBe("cli-agy::gemini-3.8-flash-high");
    const info = resolveModel(view.extra[0].id);
    expect(info.provider).toBe("cli-agy");
    expect(parseVariantModelId(view.extra[0].id)?.wire).toBe("gemini-3.8-flash-high");
  });

  it("gives Claude Code its aliases and Codex the OpenAI names", () => {
    const claude = CATALOG_SOURCES["cli-claude"];
    const codex = CATALOG_SOURCES["cli-codex"];
    expect(claude?.kind === "static" && claude.models.map((m) => m.wire)).toContain("opus");
    expect(codex?.kind === "static" && codex.models.map((m) => m.wire)).toContain("gpt-5.5");
  });
});
