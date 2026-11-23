"""Dependency-free cleanup engine used by the sidecar unit tests."""

from __future__ import annotations

from typing import Optional

from .base import MODELS, Engine


class FakeIsolator(Engine):
    """Halves the signal, so a test can tell the cleaned audio from the input."""

    id = "fake-isolator"
    kind = "cleanup"

    def __init__(self) -> None:
        self._loaded = None
        self.calls = []

    def models(self) -> list:
        return [m for m in MODELS if m.engine == self.id]

    def load(self, model: str, device: str) -> None:
        self._loaded = model

    def unload(self) -> None:
        self._loaded = None

    def voices(self, model: str) -> list:
        return []

    def effective_device(self) -> Optional[str]:
        return "cpu" if self._loaded else None

    def synthesize(self, model, text, language, voice, sample_path, params) -> tuple:
        raise NotImplementedError("fake-isolator does not synthesize")

    def isolate(self, model: str, pcm, sample_rate: int):
        self.calls.append({"model": model, "frames": len(pcm), "rate": sample_rate})
        return [int(v) / 32768.0 * 0.5 for v in pcm]
