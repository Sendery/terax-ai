# Local dictation (speech to text) with memory tiers

Status: in progress on `feat/local-dictation` (dev.27).

## Goal

Dictation today is a cloud call (OpenAI or Groq Whisper) or a whisper.cpp server
the user runs by hand. This change adds a dictation engine Terax installs and
runs itself, on the same private runtime as the reading voices (uv, a private
Python, the hardware plan, the loopback sidecar), so that:

- audio never leaves the machine;
- the first tier fits in about 1 GB of VRAM or unified memory without quantized
  weights;
- it runs on macOS, Windows and Linux (CUDA, Apple MPS or plain CPU);
- latency after the key is released stays low, because speech is transcribed in
  segments while the user is still talking;
- Settings, Dictation looks and behaves like Settings, Voice.

Reference: the user's brief "Sistema de Speech-to-Text Local de Producción"
(ASR plus refiner, memory tiers, dictionary, writing modes, self-test).

## Tiers

| Tier | ASR | Refiner | Memory | State in dev.27 |
|------|-----|---------|--------|-----------------|
| Light | Rumble-2-Flash, 0.5B, bf16 (fp32 on CPU) | rules: model filler removal, repeat collapse, dictionary, writing mode | about 1.0 GB weights, 1.5 GB resident on MPS | shipped |
| Medium | Qwen3-ASR-1.7B, bf16 | LLM refiner (LFM3-1.7B class) | about 4 to 5 GB | planned, shown as such |
| High | Qwen3-ASR-1.7B, bf16 | larger LLM refiner, longer context | 6 to 12 GB | planned, shown as such |

Why Rumble-2-Flash for Light (measured on an M4 Pro, 2026-11-21, `say` voices
Mónica and Samantha, 16 kHz):

- Rumble-2-Flash, bf16 on MPS: 11.3 s of Spanish in 0.32 s (RTF 0.028), word
  perfect; 1.5 GB MPS driver memory, 1.16 GB RSS. On CPU, fp32, 4 threads:
  1.04 s for the same clip. Four seconds of silence give an empty string.
  Fillers ("eh") are dropped by the model; numbers come out as digits;
  `verbatim=False` collapses "que, que" into "que". A hotword context fixed
  "Kokoro" and "Zonos" in a clip where they were misheard without it.
- Parakeet TDT 0.6B v3 (parakeet-mlx, bf16/fp16): 0.10 s for the same clip, one
  error ("añades" for "añadas"), 1.3 GB active Metal memory, and an MLX-only
  fast path; the cross-platform route needs ONNX. Kept as a later option.
- Apache 2.0, 45 languages, Qwen3-ASR architecture, so the Medium tier's
  Qwen3-ASR-1.7B runs through the same adapter later.

## Backend contract

### Rust (`src-tauri/src/modules/tts`)

- `Engine::Rumble`, id `rumble`, spec version 1, Python 3.11,
  `requirements-rumble.txt`. New `Engine::kind()` returning `Speech` or
  `Transcription`, plus `Engine::SPEECH` (the five reading engines) and
  `Engine::TRANSCRIPTION` (`[Rumble]`). `Engine::ALL` keeps every engine for
  internal loops (purge, kill, jobs).
- `Model::Rumble2Flash`, id `rumble-2-flash`, repo `Reson8/Rumble-2-Flash`,
  dir `models--Reson8--Rumble-2-Flash`.
- Hardware plan for `rumble`: Apple Silicon `mps` + `bfloat16`; NVIDIA with at
  least 2 GB `cuda` + `bfloat16` (compute capability below 8 or unknown:
  `float16`); otherwise `cpu` + `float32`, threads = performance cores capped
  at 8. Torch backend as the other torch engines (`cpu` on macOS, `auto` with
  NVIDIA). Notes explain the choice, e.g. "about 1.0 GB of weights in bf16".
- Status: `TtsStatus.engines` and `TtsStatus.models` keep only speech engines
  and their models, so every reading list stays as it is. New fields
  `transcribers: EngineStatus[]` and `transcriberModels: ModelStatus[]`, same
  shapes, for `Engine::TRANSCRIPTION`.
- The existing commands accept `rumble` and `rumble-2-flash` unchanged:
  `tts_install_engine` (with `withModel`), `tts_remove_engine`,
  `tts_download_model`, `tts_remove_model`, `tts_start`, `tts_stop`.

### Sidecar (`src-tauri/resources/tts`)

- `engines/rumble.py`, `RumbleEngine` with `kind = "transcription"`;
  third-party imports inside `load()` and `transcribe()` only. `synthesize()`
  raises.
- `base.py`: `Engine.kind = "speech"` by default, a `transcribe()` method that
  raises `NotImplementedError`, and the `rumble-2-flash` ModelInfo with
  `required_files` (`model.safetensors`, `config.json`, `chat_template.jinja`,
  `tokenizer.json`, `preprocessor_config.json`, `processor_config.json`).
- `download.py`: allow patterns for `rumble-2-flash` (`*.json`, `*.jinja`,
  `*.txt`, `model.safetensors`).
- `POST /transcribe?model=rumble-2-flash&language=es-ES&filler=0&verbatim=0&digits=1`
  - Body: a 16-bit PCM mono WAV at 16 kHz, at most 20 MB (10 minutes).
  - Optional header `X-Terax-Context`: the hotword list, URL-encoded UTF-8,
    at most 2000 characters after decoding. It becomes the system prompt
    (Qwen3-ASR context biasing).
  - `language`: one of the app's BCP 47 tags (`es-ES`, `en-US`, `fr-FR`,
    `de-DE`, `it-IT`, `pt-BR`) or `auto`. Mapped to the model's English names.
  - Audio longer than 30 s is split at the quietest 200 ms inside the last
    5 s of each 30 s window, and the pieces are joined with a space.
  - Reply: `{"text": str, "language": str|null, "audioMs": int, "elapsedMs": int}`.
  - Errors use the existing `HttpError` JSON. `/transcribe` on a speech engine
    and `/synthesize` on a transcription engine answer 409 `wrong_kind`.
- `POST /warmup` on a transcription engine also runs a self-test: 1 s of
  silence must transcribe to an empty string. Reply adds
  `"selfTest": {"ok": bool, "elapsedMs": int}`.
- `GET /health` adds `"kind"`.

## Frontend contract

- `SttProvider` gains `local` ("Terax, on this machine"). Existing values stay.
- New preferences: `sttLocalModel` (`rumble-2-flash`), `sttLanguage` (`auto` or
  a `TtsLanguage`), `sttMode` (`minimal` | `prompt` | `casual` | `formal`,
  default `prompt`), `sttDictionary` (`{ written: string; spoken?: string }[]`),
  `sttLiveSegments` (boolean, default true).
- `src/modules/stt/`: catalogue of tiers, a recorder that captures 16 kHz PCM
  through an AudioWorklet and cuts segments at pauses (at least 2 s of speech
  and 600 ms of silence) while recording, a client that starts the engine when
  it is installed but stopped and posts each segment to `/transcribe`, and a
  post-processor (dictionary replacements, writing modes, segment joining).
- `useWhisperRecording` sends `local` through the segmenting recorder, so on
  release only the last segment is left to transcribe.
- Settings, Dictation gets the Voice layout: tabs Models (tier cards with
  Install, Start, Stop, Remove, the plan's fit badge and the measured speed,
  plus the cloud and whisper.cpp providers), Language and style, Dictionary
  (terms, import and export), Advanced.

## Writing modes (Light tier, deterministic)

- Minimal: drop fillers only (`filler=0`, `verbatim=1`).
- Prompt (default in the AI chat): drop fillers, collapse repeats, digits.
- Casual: as Prompt, lower-case first letter, no final period.
- Formal: as Prompt, capitalised sentences, final punctuation guaranteed.

Self-corrections ("de arquitectura, perdón, de requisitos") need the LLM
refiner of the Medium tier and are left as spoken in Light.

## Not in dev.27

- The Medium and High tiers (listed with their planned composition).
- Fine-tuning for Peninsular Spanish and the synthetic refiner dataset.
- Dictation outside the AI chat composer.
