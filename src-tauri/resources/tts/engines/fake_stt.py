"""Dependency-free transcription engine used by the sidecar unit tests."""

from __future__ import annotations

from typing import Optional

from .base import MODELS, Engine

# Peak amplitude below which the fake hears silence.
SILENCE_PEAK = 64


class FakeTranscriber(Engine):
    id = "fake-stt"
    kind = "transcription"

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
        raise NotImplementedError("fake-stt does not synthesize")

    def transcribe(self, model, pcm, language, context, options) -> dict:
        self.calls.append(
            {"model": model, "frames": len(pcm), "language": language, "context": context, "options": dict(options)}
        )
        peak = max((abs(int(v)) for v in pcm), default=0)
        if peak < SILENCE_PEAK:
            return {"text": "", "language": None}
        return {"text": "heard {} frames".format(len(pcm)), "language": language or "en-US"}
