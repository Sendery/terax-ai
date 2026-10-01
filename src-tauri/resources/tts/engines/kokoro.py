"""Kokoro-82M adapter. One KPipeline per lang_code, cached per process."""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tempfile
from typing import Optional

from .base import (
    KOKORO_DEFAULT_VOICES,
    KOKORO_VOICES,
    MODELS,
    Engine,
    kokoro_lang_code,
    split_sentences,
)

MODEL_ID = "kokoro-82m"
REPO_ID = "hexgrad/Kokoro-82M"
SAMPLE_RATE = 24000
# lang_code "e" has no built-in chunking, so the adapter splits first.
MAX_CHUNK_CHARS = 320
GAP_SECONDS = 0.12


# espeak-ng 1.52 copies the data path into a 160 byte path_home buffer. A
# longer path is silently replaced by the build-time default, after which the
# library calls exit(1) and takes the sidecar down with it. Measured: 158 works,
# 162 aborts. phonemizer resolves symlinks, so the short path must be real.
MAX_ESPEAK_DATA_PATH = 159


def _log(message: str) -> None:
    sys.stderr.write("[tts] {}\n".format(message))
    sys.stderr.flush()


def _short_data_path(data_path: str) -> str:
    if len(data_path) <= MAX_ESPEAK_DATA_PATH:
        return data_path
    tag = hashlib.sha256(data_path.encode("utf-8")).hexdigest()[:8]
    target = os.path.join(tempfile.gettempdir(), "terax-espeak-" + tag, "espeak-ng-data")
    if len(target) > MAX_ESPEAK_DATA_PATH:
        _log("espeak data path is {} chars and cannot be shortened".format(len(data_path)))
        return data_path
    if os.path.isfile(os.path.join(target, "phontab")):
        return target
    staging = target + ".partial"
    try:
        shutil.rmtree(staging, ignore_errors=True)
        shutil.rmtree(target, ignore_errors=True)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copytree(data_path, staging)
        os.replace(staging, target)
    except OSError as exc:
        _log("could not copy the espeak data to a shorter path: {}".format(exc))
        return data_path
    _log("copied espeak data to {}".format(target))
    return target


def _wire_espeak() -> None:
    """Point phonemizer at the bundled espeak-ng library and its data."""
    import espeakng_loader
    from phonemizer.backend.espeak.wrapper import EspeakWrapper

    # misaki.espeak rewires both paths at import time, so let it go first.
    try:
        import misaki.espeak  # noqa: F401
    except ImportError:
        pass

    EspeakWrapper.set_library(str(espeakng_loader.get_library_path()))
    # phonemizer-fork dropped set_data_path in some releases (kokoro#206).
    if hasattr(EspeakWrapper, "set_data_path"):
        EspeakWrapper.set_data_path(_short_data_path(str(espeakng_loader.get_data_path())))


class KokoroEngine(Engine):
    id = "kokoro"

    def __init__(self) -> None:
        self._pipelines = {}
        self._device = None
        self._espeak_ready = False

    def models(self) -> list:
        return [m for m in MODELS if m.engine == self.id]

    def voices(self, model: str) -> list:
        return list(KOKORO_VOICES)

    def effective_device(self) -> Optional[str]:
        return self._device

    def load(self, model: str, device: str) -> None:
        if model != MODEL_ID:
            raise ValueError("kokoro cannot load {}".format(model))
        self._device = self._resolve_device(device)
        if not self._espeak_ready:
            _wire_espeak()
            self._espeak_ready = True
        # Warm the English pipeline; Spanish is built on first Spanish request.
        self._pipeline("a")

    def unload(self) -> None:
        self._pipelines.clear()
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

        voice_id = self._resolve_voice(language, voice)
        pipeline = self._pipeline(kokoro_lang_code(language, voice_id))
        speed = float(params.get("speed", 1.0))
        gap = np.zeros(int(SAMPLE_RATE * GAP_SECONDS), dtype=np.float32)

        pieces = []
        for chunk in split_sentences(text, MAX_CHUNK_CHARS):
            for result in pipeline(chunk, voice=voice_id, speed=speed):
                audio = getattr(result, "audio", None)
                if audio is None:
                    audio = result[2]
                if audio is None:
                    continue
                raw = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
                if pieces:
                    pieces.append(gap)
                pieces.append(np.asarray(raw, dtype=np.float32).reshape(-1))
        if not pieces:
            raise RuntimeError("kokoro produced no audio")
        return np.concatenate(pieces), SAMPLE_RATE

    def _resolve_device(self, device: str) -> str:
        if device != "auto":
            return device
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"

    def _resolve_voice(self, language: str, voice: Optional[str]) -> str:
        if not voice:
            return KOKORO_DEFAULT_VOICES[language]
        # Comma blends are passed through verbatim; kokoro parses the weights.
        return voice

    def _pipeline(self, lang_code: str):
        existing = self._pipelines.get(lang_code)
        if existing is not None:
            return existing
        from kokoro import KPipeline

        pipeline = KPipeline(lang_code=lang_code, repo_id=REPO_ID, device=self._device)
        self._pipelines[lang_code] = pipeline
        return pipeline
