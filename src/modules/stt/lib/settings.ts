import {
  isTtsDevice,
  isTtsLanguage,
  type TtsDevice,
  type TtsLanguage,
} from "@/modules/tts/lib/engines";

/**
 * Dictation preferences that the settings store persists. Kept free of store
 * imports so the store can use the coercers without a cycle.
 */

export const STT_LOCAL_MODELS = ["rumble-2-flash"] as const;
export type SttLocalModel = (typeof STT_LOCAL_MODELS)[number];
export const DEFAULT_STT_LOCAL_MODEL: SttLocalModel = "rumble-2-flash";

export function isSttLocalModel(value: unknown): value is SttLocalModel {
  return (
    typeof value === "string" &&
    (STT_LOCAL_MODELS as readonly string[]).includes(value)
  );
}

/** `auto` lets the model detect the language of each segment. */
export type SttLanguage = "auto" | TtsLanguage;

export function isSttLanguage(value: unknown): value is SttLanguage {
  return value === "auto" || isTtsLanguage(value);
}

export const STT_MODES = ["minimal", "prompt", "casual", "formal"] as const;
export type SttMode = (typeof STT_MODES)[number];
export const DEFAULT_STT_MODE: SttMode = "prompt";

export function isSttMode(value: unknown): value is SttMode {
  return (
    typeof value === "string" && (STT_MODES as readonly string[]).includes(value)
  );
}

export const STT_MODE_LABELS: Record<SttMode, string> = {
  minimal: "Minimal",
  prompt: "Prompt",
  casual: "Casual",
  formal: "Formal",
};

export const STT_MODE_DESCRIPTIONS: Record<SttMode, string> = {
  minimal: "Drops fillers and nothing else. Repeated words stay as spoken.",
  prompt:
    "For the AI chat and terminals: no fillers, repeated words collapsed, numbers as digits.",
  casual:
    "For chats: like Prompt, starting in lower case and without a final period.",
  formal:
    "For email and documents: like Prompt, every sentence capitalised and closed.",
};

/** One dictionary term. `spoken` is how the model tends to write it when it
 *  mishears it; `written` is what ends up in the text. */
export type SttDictionaryEntry = {
  written: string;
  spoken?: string;
};

export const STT_DICTIONARY_MAX_ENTRIES = 500;
export const STT_TERM_MAX_CHARS = 80;

function cleanTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0 || trimmed.length > STT_TERM_MAX_CHARS) return null;
  return trimmed;
}

function termKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Valid, trimmed, deduplicated entries in their stored order, capped. */
export function coerceSttDictionary(value: unknown): SttDictionaryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: SttDictionaryEntry[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (out.length >= STT_DICTIONARY_MAX_ENTRIES) break;
    if (!raw || typeof raw !== "object") continue;
    const written = cleanTerm((raw as { written?: unknown }).written);
    if (!written) continue;
    const spokenRaw = cleanTerm((raw as { spoken?: unknown }).spoken);
    const spoken =
      spokenRaw && termKey(spokenRaw) !== termKey(written) ? spokenRaw : undefined;
    const key = `${termKey(written)}\u0000${spoken ? termKey(spoken) : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spoken ? { written, spoken } : { written });
  }
  return out;
}

export function coerceSttLanguage(value: unknown): SttLanguage {
  return isSttLanguage(value) ? value : "auto";
}

export function coerceSttMode(value: unknown): SttMode {
  return isSttMode(value) ? value : DEFAULT_STT_MODE;
}

export function coerceSttLocalModel(value: unknown): SttLocalModel {
  return isSttLocalModel(value) ? value : DEFAULT_STT_LOCAL_MODEL;
}

export function coerceSttDevice(value: unknown): TtsDevice {
  return isTtsDevice(value) ? value : "auto";
}

/**
 * Parses an imported dictionary. Accepts the JSON Terax exports (an array of
 * entries, or `{ terms: [...] }`) and plain text with one term per line,
 * where `spoken => written` (or `spoken -> written`) records a correction.
 */
export function parseSttDictionaryImport(text: string): SttDictionaryEntry[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed as { terms?: unknown })?.terms;
      return coerceSttDictionary(list);
    } catch {
      // Not JSON after all: fall through to the line format.
    }
  }
  const entries = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line): SttDictionaryEntry => {
      const match = line.split(/\s*(?:=>|->)\s*/);
      if (match.length === 2) return { spoken: match[0], written: match[1] };
      return { written: line };
    });
  return coerceSttDictionary(entries);
}

/** The JSON a dictionary export writes; `parseSttDictionaryImport` reads it back. */
export function serializeSttDictionary(entries: SttDictionaryEntry[]): string {
  return `${JSON.stringify({ terms: coerceSttDictionary(entries) }, null, 2)}\n`;
}
