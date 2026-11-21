"""Reson8 Rumble-2-Flash, the Light dictation tier.

A 0.5B model on the Qwen3-ASR architecture, run with plain transformers in the
precision the hardware plan picks: bfloat16 on a GPU (about 1.0 GB of weights,
no quantization) and float32 on a CPU. Long audio is transcribed in windows of
at most 30 seconds, cut at the quietest stretch near each window's end.

The model's chat template takes three switches as control tokens: `digits`
(numbers as digits), `filler` (keep "um" and "eh") and `verbatim` (keep
repeated words). A system prompt is Qwen3-ASR context biasing: the user's
dictionary terms go there.
"""

from __future__ import annotations

import sys
from typing import Optional

from .base import (
    MODELS,
    TRANSCRIPTION_LANGUAGE_TAGS,
    TRANSCRIPTION_LANGUAGES,
    TRANSCRIPTION_SAMPLE_RATE,
    Engine,
    join_pieces,
    split_windows,
)
from .plan import apply_threads, load_plan, resolve_device, torch_dtype

MODEL_ID = "rumble-2-flash"
REPO_ID = "Reson8/Rumble-2-Flash"
# The model's own generation default; 30 s of fast speech stays well below it.
MAX_NEW_TOKENS = 512


def _log(message: str) -> None:
    sys.stderr.write("[tts] {}\n".format(message))
    sys.stderr.flush()


def language_tag(name: Optional[str]) -> Optional[str]:
    """The app tag for a language the model reports, else its own name."""
    if not name:
        return None
    return TRANSCRIPTION_LANGUAGE_TAGS.get(name, name)


def template_switches(options: dict) -> dict:
    """The chat template variables, with the model card's defaults."""
    return {
        "filler": bool(options.get("filler", False)),
        "verbatim": bool(options.get("verbatim", True)),
        "digits": bool(options.get("digits", True)),
    }


class RumbleEngine(Engine):
    id = "rumble"
    kind = "transcription"

    def __init__(self) -> None:
        self._plan = load_plan()
        self._processor = None
        self._model = None
        self._device: Optional[str] = None

    def models(self) -> list:
        return [m for m in MODELS if m.engine == self.id]

    def voices(self, model: str) -> list:
        return []

    def effective_device(self) -> Optional[str]:
        return self._device

    def load(self, model: str, device: str) -> None:
        if model != MODEL_ID:
            raise ValueError("rumble cannot load {}".format(model))
        if self._model is not None:
            return
        import torch
        from huggingface_hub import snapshot_download
        from transformers import AutoModelForMultimodalLM, AutoProcessor

        resolved = resolve_device(device, self._plan)
        if resolved == "mps" and not torch.backends.mps.is_available():
            resolved = "cpu"
        if resolved == "cuda" and not torch.cuda.is_available():
            resolved = "cpu"
        dtype = torch_dtype(self._plan.dtype or "bfloat16", resolved)
        if resolved == "cuda" and dtype == torch.bfloat16 and not torch.cuda.is_bf16_supported():
            # Pre-Ampere GPUs have no bfloat16; float16 keeps the same footprint.
            dtype = torch.float16
        if resolved == "cpu":
            apply_threads(self._plan)
        root = snapshot_download(repo_id=REPO_ID, local_files_only=True)
        processor = AutoProcessor.from_pretrained(root)
        loaded = AutoModelForMultimodalLM.from_pretrained(root, dtype=dtype)
        self._model = loaded.to(resolved).eval()
        self._processor = processor
        self._device = resolved
        _log("rumble loaded on {} in {}".format(resolved, str(dtype).replace("torch.", "")))

    def unload(self) -> None:
        self._model = None
        self._processor = None
        self._device = None
        try:
            import torch

            if torch.backends.mps.is_available():
                torch.mps.empty_cache()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def synthesize(self, model, text, language, voice, sample_path, params) -> tuple:
        raise NotImplementedError("rumble transcribes; it does not read aloud")

    def transcribe(
        self,
        model: str,
        pcm,
        language: Optional[str],
        context: Optional[str],
        options: dict,
    ) -> dict:
        if self._model is None or self._processor is None:
            raise RuntimeError("rumble is not loaded")
        import numpy as np
        import torch

        samples = np.asarray(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        forced = TRANSCRIPTION_LANGUAGES.get(language) if language else None
        switches = template_switches(options)
        pieces = []
        detected = None
        for start, end in split_windows(samples, TRANSCRIPTION_SAMPLE_RATE):
            window = samples[start:end]
            inputs = self._processor.apply_transcription_request(
                audio=window,
                language=forced,
                prompt=context or None,
                **switches,
            ).to(self._model.device, dtype=self._model.dtype)
            with torch.inference_mode():
                output = self._model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS)
            generated = output[:, inputs["input_ids"].shape[-1]:]
            parsed = self._processor.decode(generated, return_format="parsed")[0]
            if isinstance(parsed, dict):
                pieces.append(parsed.get("transcription") or "")
                detected = detected or parsed.get("language")
            else:
                pieces.append(str(parsed))
        return {
            "text": join_pieces(pieces),
            "language": language if forced else language_tag(detected),
        }
