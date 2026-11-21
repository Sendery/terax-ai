import type { SttLocalModel } from "./settings";

/**
 * Local dictation engines and the memory tiers Settings, Dictation offers.
 * Closed lists, matching the Rust catalogue (`Engine::Rumble`) and the
 * sidecar's `rumble-2-flash` model.
 */

export const STT_ENGINES = ["rumble"] as const;
export type SttEngineId = (typeof STT_ENGINES)[number];

export const STT_ENGINE_LABELS: Record<SttEngineId, string> = {
  rumble: "Rumble",
};

export const STT_MODEL_ENGINE: Record<SttLocalModel, SttEngineId> = {
  "rumble-2-flash": "rumble",
};

export const STT_MODEL_LABELS: Record<SttLocalModel, string> = {
  "rumble-2-flash": "Rumble-2-Flash",
};

/** Torch, transformers and their wheels, as installed into the private venv
 *  (measured at about 740 MB on macOS arm64). */
export const STT_ENGINE_APPROX_BYTES: Record<SttEngineId, number> = {
  rumble: 800 * 1024 * 1024,
};

/** `model.safetensors` (1.02 GB) plus tokenizer and config files. */
export const STT_MODEL_APPROX_BYTES: Record<SttLocalModel, number> = {
  "rumble-2-flash": 980 * 1024 * 1024,
};

export type SttTierId = "light" | "medium" | "high";

export type SttTier = {
  id: SttTierId;
  label: string;
  /** Short line under the title. */
  summary: string;
  /** Memory the tier needs while it transcribes (VRAM or unified memory). */
  memory: string;
  asr: string;
  refiner: string;
  /** Shipped and installable, or listed so the next tiers are visible. */
  state: "available" | "planned";
  /** The installable model, for available tiers. */
  model: SttLocalModel | null;
  facts: string[];
};

export const STT_TIERS: readonly SttTier[] = [
  {
    id: "light",
    label: "Light",
    summary:
      "Rumble-2-Flash in bf16, not quantized. Fits in about 1 GB of VRAM or unified memory.",
    memory: "about 1.0 GB of weights",
    asr: "Rumble-2-Flash, 0.5B parameters, bf16 (fp32 on CPU)",
    refiner:
      "Rules: fillers dropped by the model, repeated words collapsed, your dictionary and the writing style",
    state: "available",
    model: "rumble-2-flash",
    facts: [
      "45 languages, Spanish and English included",
      "Silence transcribes to nothing, so no invented text",
      "Apache 2.0",
    ],
  },
  {
    id: "medium",
    label: "Medium",
    summary:
      "A larger recogniser plus a small language model that rewrites what you meant to say.",
    memory: "about 4 to 5 GB",
    asr: "Qwen3-ASR-1.7B, bf16",
    refiner: "LLM refiner of the LFM3-1.7B class: self-corrections, punctuation, style",
    state: "planned",
    model: null,
    facts: ["For Macs with 16 GB and GPUs with 6 to 8 GB"],
  },
  {
    id: "high",
    label: "High",
    summary: "The best quality that still runs on this machine.",
    memory: "6 to 12 GB",
    asr: "Qwen3-ASR-1.7B, bf16",
    refiner: "Larger LLM refiner with a longer context",
    state: "planned",
    model: null,
    facts: ["For Macs with 32 GB and GPUs with 12 GB or more"],
  },
];
