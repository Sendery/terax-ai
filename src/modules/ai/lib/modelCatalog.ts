import {
  MODELS,
  type ProviderId,
  variantModelId,
} from "@/modules/ai/config";

/** One model as a provider or CLI names it. */
export type CatalogModel = { wire: string; label: string };

export type CatalogSource =
  | { kind: "api"; url: string; auth: "bearer" | "anthropic" | "google" | "none" }
  | { kind: "cli"; argv: string[]; parse: (lines: string[]) => CatalogModel[] }
  | { kind: "pi" }
  | { kind: "static"; models: CatalogModel[] };

/** How long a fetched catalogue is trusted before the picker refreshes it. */
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_MAX_MODELS = 1000;

const WIRE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

function staticWires(vendor: ProviderId): CatalogModel[] {
  return MODELS.filter((m) => m.provider === vendor).map((m) => ({
    wire: m.id,
    label: m.label,
  }));
}

/** `agy models`: a progress line, then `<id>\t<label>` rows. */
export function parseAgyModels(lines: readonly string[]): CatalogModel[] {
  const out: CatalogModel[] = [];
  for (const line of lines) {
    const [wire, label] = line.split("\t").map((part) => part?.trim());
    if (wire && label && WIRE_RE.test(wire)) out.push({ wire, label });
  }
  return out;
}

/** `opencode models`: one `provider/model` per line. */
export function parseOpencodeModels(lines: readonly string[]): CatalogModel[] {
  const out: CatalogModel[] = [];
  for (const line of lines) {
    const wire = line.trim();
    if (wire.includes("/") && WIRE_RE.test(wire)) out.push({ wire, label: wire });
  }
  return out;
}

/**
 * Where each provider's catalogue comes from. API providers list theirs at
 * `/models`; CLIs that can list models are asked; Claude Code and Codex take
 * the same names as their vendor's API, so they reuse its built-in list (plus
 * Claude Code's short aliases); Copilot only documents `auto`.
 */
export const CATALOG_SOURCES: Partial<Record<ProviderId, CatalogSource>> = {
  openai: { kind: "api", url: "https://api.openai.com/v1/models", auth: "bearer" },
  anthropic: { kind: "api", url: "https://api.anthropic.com/v1/models?limit=1000", auth: "anthropic" },
  google: {
    kind: "api",
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    auth: "google",
  },
  xai: { kind: "api", url: "https://api.x.ai/v1/models", auth: "bearer" },
  cerebras: { kind: "api", url: "https://api.cerebras.ai/v1/models", auth: "bearer" },
  groq: { kind: "api", url: "https://api.groq.com/openai/v1/models", auth: "bearer" },
  deepseek: { kind: "api", url: "https://api.deepseek.com/models", auth: "bearer" },
  mistral: { kind: "api", url: "https://api.mistral.ai/v1/models", auth: "bearer" },
  openrouter: { kind: "api", url: "https://openrouter.ai/api/v1/models", auth: "none" },
  "cli-agy": { kind: "cli", argv: ["agy", "models"], parse: parseAgyModels },
  "cli-opencode": { kind: "cli", argv: ["opencode", "models"], parse: parseOpencodeModels },
  "cli-pi": { kind: "pi" },
  "cli-claude": {
    kind: "static",
    models: [
      { wire: "opus", label: "Opus (latest)" },
      { wire: "sonnet", label: "Sonnet (latest)" },
      { wire: "haiku", label: "Haiku (latest)" },
      ...staticWires("anthropic"),
    ],
  },
  "cli-codex": { kind: "static", models: staticWires("openai") },
  "cli-copilot": { kind: "static", models: [{ wire: "auto", label: "Auto (Copilot picks)" }] },
};

const NON_CHAT =
  /(embed|embedding|tts|whisper|transcribe|dall-e|image|imagen|audio|moderation|realtime|search|rerank|veo|aqa|davinci|babbage|guard)/i;

function rows(json: unknown, key: string): Record<string, unknown>[] {
  const list = (json as Record<string, unknown> | null)?.[key];
  return Array.isArray(list)
    ? list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [];
}

/** Chat models out of a provider's `/models` reply. Unknown shapes yield an
 *  empty list, which callers treat as "keep the built-in list". */
export function parseApiModels(provider: ProviderId, json: unknown): CatalogModel[] {
  const out: CatalogModel[] = [];
  const push = (wire: unknown, label: unknown) => {
    if (typeof wire !== "string" || !WIRE_RE.test(wire) || NON_CHAT.test(wire)) return;
    out.push({ wire, label: typeof label === "string" && label.trim() ? label.trim() : wire });
  };
  if (provider === "google") {
    for (const m of rows(json, "models")) {
      const methods = m.supportedGenerationMethods;
      if (Array.isArray(methods) && !methods.includes("generateContent")) continue;
      const name = typeof m.name === "string" ? m.name.replace(/^models\//, "") : null;
      push(name, m.displayName);
    }
  } else {
    for (const m of rows(json, "data")) push(m.id, m.display_name ?? m.name);
  }
  const unique = new Map<string, CatalogModel>();
  for (const m of out) if (!unique.has(m.wire)) unique.set(m.wire, m);
  return [...unique.values()].slice(0, CATALOG_MAX_MODELS);
}

export type CatalogView = {
  /** Picker ids for models the built-in list does not have. */
  extra: { id: string; wire: string; label: string }[];
  /** Built-in ids the provider no longer lists. Only for live catalogues. */
  unlisted: Set<string>;
};

/**
 * Reconcile a catalogue with the built-in list. For an API provider a model
 * already built in keeps its built-in entry (and its capability scores); the
 * rest become variants. For a CLI every listed model is a variant of the CLI.
 */
export function reconcileCatalog(
  provider: ProviderId,
  models: readonly CatalogModel[],
  live: boolean,
): CatalogView {
  const builtIn = new Set(
    MODELS.filter((m) => m.provider === provider).map((m) => m.id as string),
  );
  const isCli = provider.startsWith("cli-");
  const extra = models
    .filter((m) => isCli || !builtIn.has(m.wire))
    .map((m) => ({ id: variantModelId(provider, m.wire), wire: m.wire, label: m.label }));
  const listed = new Set(models.map((m) => m.wire));
  const unlisted =
    live && !isCli && models.length > 0
      ? new Set([...builtIn].filter((id) => !listed.has(id) && !id.endsWith("-custom")))
      : new Set<string>();
  return { extra, unlisted };
}
