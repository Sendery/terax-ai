"""Dependency-free engine used by the sidecar unit tests."""

from __future__ import annotations

import array
import math
from typing import Optional

from .base import MODELS, Engine, VoiceInfo, collapse_whitespace

SAMPLE_RATE = 24000
TONE_HZ = 440.0
SECONDS_PER_CHAR = 0.02

VOICES = (
    VoiceInfo(id="fake_a", label="Fake A (f)", language="en-US"),
    VoiceInfo(id="fake_b", label="Fake B (m)", language="es-ES"),
)


class FakeEngine(Engine):
    id = "fake"

    def __init__(self) -> None:
        self._loaded = None
        self._device = None

    def models(self) -> list:
        return [m for m in MODELS if m.engine == self.id]

    def load(self, model: str, device: str) -> None:
        self._loaded = model
        self._device = "cpu" if device == "auto" else device

    def unload(self) -> None:
        self._loaded = None

    def voices(self, model: str) -> list:
        return list(VOICES)

    def effective_device(self) -> Optional[str]:
        return self._device

    def synthesize(
        self,
        model: str,
        text: str,
        language: str,
        voice: Optional[str],
        sample_path: Optional[str],
        params: dict,
    ) -> tuple:
        speed = float(params.get("speed", 1.0))
        chars = max(1, len(collapse_whitespace(text)))
        frames = max(1, int(SAMPLE_RATE * chars * SECONDS_PER_CHAR / speed))
        step = 2.0 * math.pi * TONE_HZ / SAMPLE_RATE
        samples = array.array("f", (0.3 * math.sin(step * i) for i in range(frames)))
        return samples, SAMPLE_RATE
