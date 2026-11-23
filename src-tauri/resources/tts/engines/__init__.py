"""Speech, transcription and cleanup engine adapters. Third-party imports stay inside load()/synthesize()."""

from __future__ import annotations


def create_engine(name: str):
    if name == "fake":
        from .fake import FakeEngine

        return FakeEngine()
    if name == "fake-stt":
        from .fake_stt import FakeTranscriber

        return FakeTranscriber()
    if name == "rumble":
        from .rumble import RumbleEngine

        return RumbleEngine()
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
    if name == "isolator":
        from .isolator import IsolatorEngine

        return IsolatorEngine()
    if name == "fake-isolator":
        from .fake_isolator import FakeIsolator

        return FakeIsolator()
    raise ValueError("unknown engine: {}".format(name))
