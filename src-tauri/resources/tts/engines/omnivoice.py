"""k2-fsa OmniVoice adapter: cloning, voice design and an automatic voice.

Cloning a sample needs its transcript. Terax samples carry none, so the first
use of a sample transcribes it with Whisper (downloaded into the private model
cache on that first use) and saves the resulting voice prompt next to the
other private files. Every later sentence reuses the saved prompt, so neither
Whisper nor the reference encoder runs again for that sample.
"""

from __future__ import annotations

import hashlib
import os
import sys
from typing import Optional

from .base import (
    MODELS,
    OMNIVOICE_AUTO_VOICE,
    OMNIVOICE_DESIGNS,
    OMNIVOICE_LANGUAGES,
    OMNIVOICE_VOICES,
    Engine,
)
from .plan import apply_threads, load_plan, resolve_device, torch_dtype

MODEL_ID = "omnivoice"
REPO_ID = "k2-fsa/OmniVoice"
SAMPLE_RATE = 24000
DEFAULT_STEPS = 32


def _log(message: str) -> None:
    sys.stderr.write("[tts] {}\n".format(message))
    sys.stderr.flush()


def prompt_cache_dir() -> str:
    root = os.environ.get("TMPDIR") or os.environ.get("TEMP") or "."
    return os.path.join(root, "omnivoice-prompts")


def sample_key(path: str) -> str:
    """Content hash, so a re-imported sample with the same audio reuses its prompt."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 16), b""):
            digest.update(block)
    return digest.hexdigest()[:24]


def resolve_mode(voice: Optional[str], sample_path: Optional[str]) -> tuple:
    """(mode, value): ("clone", path), ("design", instruct) or ("auto", None)."""
    if sample_path:
        return "clone", sample_path
    if voice and voice in OMNIVOICE_DESIGNS:
        return "design", OMNIVOICE_DESIGNS[voice]
    if voice in (None, "", OMNIVOICE_AUTO_VOICE):
        return "auto", None
    raise ValueError("unknown omnivoice voice: {}".format(voice))


class OmniVoiceEngine(Engine):
    id = "omnivoice"

    def __init__(self) -> None:
        self._plan = load_plan()
        self._device: Optional[str] = None
        self._model = None
        self._prompts = {}

    def models(self) -> list:
        return [m for m in MODELS if m.engine == self.id]

    def voices(self, model: str) -> list:
        return list(OMNIVOICE_VOICES)

    def effective_device(self) -> Optional[str]:
        return self._device

    def load(self, model: str, device: str) -> None:
        if model != MODEL_ID:
            raise ValueError("omnivoice cannot load {}".format(model))
        import torch
        from omnivoice import OmniVoice

        self._device = resolve_device(device, self._plan)
        if self._device == "mps" and not torch.backends.mps.is_available():
            self._device = "cpu"
        if self._device == "cuda" and not torch.cuda.is_available():
            self._device = "cpu"
        apply_threads(self._plan)
        device_map = "cuda:0" if self._device == "cuda" else self._device
        self._model = OmniVoice.from_pretrained(
            REPO_ID,
            device_map=device_map,
            dtype=torch_dtype(self._plan.dtype, self._device),
            # Whisper only ever runs to transcribe a new sample; the CPU keeps
            # it out of the GPU memory the synthesis model needs.
            asr_device="cpu" if self._device == "mps" else None,
        )

    def unload(self) -> None:
        self._model = None
        self._prompts.clear()
        self._device = None

    def synthesize(
        self,
        model: str,
        text: str,
        language: str,
        voice: Optional[str],
        sample_path: Optional[str],
        params: dict,
    ) -> tuple:
        import numpy as np

        if self._model is None:
            raise RuntimeError("omnivoice is not loaded")
        mode, value = resolve_mode(voice, sample_path)
        steps = int(params.get("steps") or self._plan.steps or DEFAULT_STEPS)
        kwargs = {
            "language": OMNIVOICE_LANGUAGES[language],
            "num_step": steps,
        }
        if "speed" in params:
            kwargs["speed"] = float(params["speed"])
        if mode == "clone":
            kwargs["voice_clone_prompt"] = self._prompt(value)
        elif mode == "design":
            kwargs["instruct"] = value
        audio = self._model.generate(text=text, **kwargs)
        if not audio:
            raise RuntimeError("omnivoice produced no audio")
        return np.asarray(audio[0], dtype=np.float32).reshape(-1), SAMPLE_RATE

    def _prompt(self, sample_path: str):
        key = sample_key(sample_path)
        cached = self._prompts.get(key)
        if cached is not None:
            return cached
        from omnivoice import VoiceClonePrompt

        folder = prompt_cache_dir()
        path = os.path.join(folder, key + ".pt")
        prompt = None
        if os.path.isfile(path):
            try:
                prompt = VoiceClonePrompt.load(path)
            except Exception as exc:
                _log("discarding a stale voice prompt: {}".format(exc))
        if prompt is None:
            _log("transcribing a new sample once to build its voice prompt")
            prompt = self._model.create_voice_clone_prompt(ref_audio=sample_path, ref_text=None)
            os.makedirs(folder, exist_ok=True)
            prompt.save(path)
        self._prompts[key] = prompt
        return prompt
