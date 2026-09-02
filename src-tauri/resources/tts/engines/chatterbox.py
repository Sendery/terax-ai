"""Chatterbox adapter (multilingual, turbo, nano). Cloning only."""

from __future__ import annotations

import importlib
import sys
from typing import Optional

from .base import CHATTERBOX_LANG_IDS, MODELS, Engine, split_sentences

MULTILINGUAL_ID = "chatterbox-multilingual"
TURBO_ID = "chatterbox-turbo"
NANO_ID = "chatterbox-nano"
# Turbo and Nano degrade on very long inputs, so long text is chunked.
MAX_CHUNK_CHARS = 300
GAP_SECONDS = 0.15

_MULTILINGUAL_MODULES = ("chatterbox.mtl_tts", "chatterbox")
_TURBO_MODULES = ("chatterbox.tts_turbo", "chatterbox.turbo_tts", "chatterbox.tts", "chatterbox")


def _log(message: str) -> None:
    sys.stderr.write("[tts] {}\n".format(message))
    sys.stderr.flush()


def _load_class(name: str, modules: tuple):
    for module_name in modules:
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            continue
        found = getattr(module, name, None)
        if found is not None:
            return found
    raise RuntimeError("{} not found in chatterbox-tts".format(name))


class ChatterboxEngine(Engine):
    id = "chatterbox"

    def __init__(self) -> None:
        self._model = None
        self._model_id = None
        self._device = None

    def models(self) -> list:
        return [m for m in MODELS if m.engine == self.id]

    def voices(self, model: str) -> list:
        return []

    def effective_device(self) -> Optional[str]:
        return self._device

    def load(self, model: str, device: str) -> None:
        target = self._resolve_device(device)
        try:
            self._model = self._instantiate(model, target)
        except Exception as exc:
            if target != "mps":
                raise
            # MPS load failures are common on older torch builds; cpu always works.
            _log("mps load failed ({}), retrying on cpu".format(exc))
            target = "cpu"
            self._model = self._instantiate(model, target)
        self._model_id = model
        self._device = target

    def unload(self) -> None:
        self._model = None
        self._model_id = None
        self._device = None
        try:
            import gc

            import torch

            gc.collect()
            if hasattr(torch, "mps") and torch.backends.mps.is_available():
                torch.mps.empty_cache()
            elif torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

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

        if self._model is None or self._model_id != model:
            raise RuntimeError("{} is not loaded".format(model))
        if not sample_path:
            raise RuntimeError("{} requires a voice sample".format(model))

        kwargs = {"audio_prompt_path": sample_path}
        for key, name in (
            ("exaggeration", "exaggeration"),
            ("cfgWeight", "cfg_weight"),
            ("temperature", "temperature"),
        ):
            if key in params:
                kwargs[name] = params[key]
        if model == MULTILINGUAL_ID:
            kwargs["language_id"] = CHATTERBOX_LANG_IDS[language]

        sample_rate = int(getattr(self._model, "sr", 24000))
        gap = np.zeros(int(sample_rate * GAP_SECONDS), dtype=np.float32)
        pieces = []
        for chunk in split_sentences(text, MAX_CHUNK_CHARS):
            wav = self._model.generate(chunk, **kwargs)
            raw = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
            if pieces:
                pieces.append(gap)
            pieces.append(np.asarray(raw, dtype=np.float32).reshape(-1))
        if not pieces:
            raise RuntimeError("chatterbox produced no audio")
        return np.concatenate(pieces), sample_rate

    def _instantiate(self, model: str, device: str):
        if model == MULTILINGUAL_ID:
            cls = _load_class("ChatterboxMultilingualTTS", _MULTILINGUAL_MODULES)
            return cls.from_pretrained(device=device, t3_model="v3")
        if model == TURBO_ID:
            cls = _load_class("ChatterboxTurboTTS", _TURBO_MODULES)
            return cls.from_pretrained(device=device)
        if model == NANO_ID:
            cls = _load_class("ChatterboxTurboTTS", _TURBO_MODULES)
            return cls.from_pretrained(device=device, nano=True)
        raise ValueError("chatterbox cannot load {}".format(model))

    def _resolve_device(self, device: str) -> str:
        if device != "auto":
            return device
        import platform

        import torch

        if platform.machine() in ("arm64", "aarch64") and torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"
