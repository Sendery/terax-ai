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
    if name == "pocket":
        from .pocket import PocketEngine

        return PocketEngine()
    if name == "omnivoice":
        from .omnivoice import OmniVoiceEngine

        return OmniVoiceEngine()
    if name == "zonos3":
        from .zonos3 import Zonos3Engine

        return Zonos3Engine()
    raise ValueError("unknown engine: {}".format(name))
