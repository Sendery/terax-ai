"""TTS engine adapters. Third-party imports stay inside load()/synthesize()."""

from __future__ import annotations


def create_engine(name: str):
    if name == "fake":
        from .fake import FakeEngine

        return FakeEngine()
    if name == "kokoro":
        from .kokoro import KokoroEngine

        return KokoroEngine()
    if name == "chatterbox":
        from .chatterbox import ChatterboxEngine

        return ChatterboxEngine()
    raise ValueError("unknown engine: {}".format(name))
