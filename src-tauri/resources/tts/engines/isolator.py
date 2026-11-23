"""Inworld Voice Isolator, the audio cleanup engine.

Removes noise and background from speech: the dictation microphone before it
is transcribed, a reading engine's output before it plays, and a voice sample
before it is cloned. The offline checkpoint (64M parameters, 48 kHz) is used
for all three, since each caller hands it a finished clip.

The network is a band-split Mamba. Without the optional CUDA kernels
(`mamba-ssm`, which need a build toolchain) the scan runs in plain PyTorch:
measured on an RTX 3060, 0.35 s per second of audio; on 16 CPU threads, 8.7 s.
The plan says so on the card; nothing here refuses a slow device.
"""

from __future__ import annotations

import sys
from typing import Optional

from .base import (
    ISOLATOR_MODEL_ID,
    ISOLATOR_SHA256,
    MODELS,
    Engine,
    isolator_weights_path,
)
from .plan import apply_threads, load_plan, resolve_device


def _log(message: str) -> None:
    try:
        sys.stderr.write("[tts] {}\n".format(message))
        sys.stderr.flush()
    except (OSError, ValueError):
        pass


def _sha256(path: str) -> str:
    import hashlib

    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 24), b""):
            digest.update(block)
    return digest.hexdigest()


class IsolatorEngine(Engine):
    id = "isolator"
    kind = "cleanup"

    def __init__(self) -> None:
        self._plan = load_plan()
        self._isolator = None
        self._device: Optional[str] = None

    def models(self) -> list:
        return [m for m in MODELS if m.engine == self.id]

    def voices(self, model: str) -> list:
        return []

    def effective_device(self) -> Optional[str]:
        return self._device

    def synthesize(self, model, text, language, voice, sample_path, params) -> tuple:
        raise NotImplementedError("the isolator does not synthesize")

    def load(self, model: str, device: str) -> None:
        if model != ISOLATOR_MODEL_ID:
            raise ValueError("the isolator cannot load {}".format(model))
        if self._isolator is not None:
            return
        path = isolator_weights_path()
        # The download pins the revision; the checksum is what proves the file
        # under that revision is the one the package was released against.
        digest = _sha256(path)
        if digest != ISOLATOR_SHA256:
            raise RuntimeError("isolator weights checksum mismatch: {}".format(digest))

        apply_threads(self._plan)
        resolved = resolve_device(device, self._plan)
        if resolved not in ("cpu", "cuda", "mps"):
            resolved = "cpu"

        from inworld.voice_isolation import VoiceIsolator
        from inworld.voice_isolation.isolator import default_device

        if resolved == "mps" and default_device().type != "mps":
            # The package's own probe: PyTorch older than 2.6, or a macOS whose
            # Metal backend lacks the FFT, would produce wrong audio on MPS.
            _log("MPS cannot run the isolator here, using the CPU")
            resolved = "cpu"

        _log("loading {} on {}".format(model, resolved))
        self._isolator = VoiceIsolator(path, device=resolved, mode="offline")
        self._device = resolved

    def unload(self) -> None:
        self._isolator = None
        self._device = None
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def isolate(self, model: str, pcm, sample_rate: int):
        if self._isolator is None:
            raise RuntimeError("the isolator is not loaded")
        import numpy as np

        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        voice = self._isolator.isolate(audio, sample_rate)
        return np.asarray(voice, dtype=np.float32).reshape(-1)
