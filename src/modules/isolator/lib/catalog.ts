/**
 * Audio cleanup engines. A closed list, matching the Rust catalogue
 * (`Engine::Isolator`, `EngineKind::Cleanup`) and the sidecar's
 * `voice-isolator-v1` model.
 */

export const CLEANUP_ENGINES = ["isolator"] as const;
export type CleanupEngineId = (typeof CLEANUP_ENGINES)[number];

export const CLEANUP_MODELS = ["voice-isolator-v1"] as const;
export type CleanupModelId = (typeof CLEANUP_MODELS)[number];

export const ISOLATOR_ENGINE: CleanupEngineId = "isolator";
export const ISOLATOR_MODEL: CleanupModelId = "voice-isolator-v1";

export const CLEANUP_ENGINE_LABELS: Record<CleanupEngineId, string> = {
  isolator: "Voice Isolator",
};

export const CLEANUP_ENGINE_DESCRIPTIONS: Record<CleanupEngineId, string> = {
  isolator:
    "Inworld's 48 kHz voice isolation: removes noise and background around a voice, keeping the speaker's timbre. Apache-2.0.",
};

/** PyTorch, torchaudio and the package with CPU wheels: 830 MB measured on
 *  Linux. The CUDA build an NVIDIA machine installs measured 4.9 GB. */
export const CLEANUP_ENGINE_APPROX_BYTES: Record<CleanupEngineId, number> = {
  isolator: 830 * 1024 * 1024,
};
export const CLEANUP_ENGINE_CUDA_APPROX_BYTES: Record<CleanupEngineId, number> = {
  isolator: 4_900 * 1024 * 1024,
};

/** `denoiser.safetensors`, the offline checkpoint only. */
export const CLEANUP_MODEL_APPROX_BYTES: Record<CleanupModelId, number> = {
  "voice-isolator-v1": 245 * 1024 * 1024,
};

export function isCleanupEngineId(value: unknown): value is CleanupEngineId {
  return (
    typeof value === "string" &&
    (CLEANUP_ENGINES as readonly string[]).includes(value)
  );
}
