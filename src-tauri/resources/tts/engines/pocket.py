"""Kyutai Pocket TTS adapter: one small model per language, preset voices.

Each language is its own checkpoint, so the adapter keeps one loaded model per
language and builds it on the first request in that language. Voice states are
cached per (language, voice): turning a voice into a model state is the slow
part of a request, and the Reader asks for the same voice sentence after
sentence.
"""

from __future__ import annotations

import sys
from typing import Optional

from .base import (
    MODELS,
    POCKET_DEFAULT_VOICES,
    POCKET_LANGUAGES,
    POCKET_VOICES,
    Engine,
)
from .plan import apply_threads, load_plan, resolve_device

MODEL_ID = "pocket-tts"
VOICE_IDS = frozenset(v.id for v in POCKET_VOICES)


def _log(message: str) -> None:
    sys.stderr.write("[tts] {}\n".format(message))
    sys.stderr.flush()


class PocketEngine(Engine):
    id = "pocket"

    def __init__(self) -> None:
        self._plan = load_plan()
        self._device: Optional[str] = None
        self._models = {}
        self._states = {}

    def models(self) -> list:
        return [m for m in MODELS if m.engine == self.id]

    def voices(self, model: str) -> list:
        return list(POCKET_VOICES)

    def effective_device(self) -> Optional[str]:
        return self._device

    def load(self, model: str, device: str) -> None:
        if model != MODEL_ID:
            raise ValueError("pocket cannot load {}".format(model))
        self._device = resolve_device(device, self._plan)
        if self._device not in ("cpu", "cuda"):
            # Pocket TTS has no MPS path, and on Apple Silicon the CPU is the
            # faster device anyway.
            self._device = "cpu"
        # Warm English; Spanish loads on its first request.
        self._model("en-US")

    def unload(self) -> None:
        self._models.clear()
        self._states.clear()
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

        voice_id = voice or POCKET_DEFAULT_VOICES[language]
        if voice_id not in VOICE_IDS:
            raise ValueError("unknown pocket voice: {}".format(voice_id))
        tts = self._model(language)
        state = self._state(language, voice_id)
        audio = tts.generate_audio(state, text)
        samples = audio.detach().cpu().numpy() if hasattr(audio, "detach") else np.asarray(audio)
        return np.asarray(samples, dtype=np.float32).reshape(-1), int(tts.sample_rate)

    def _model(self, language: str):
        existing = self._models.get(language)
        if existing is not None:
            return existing
        from pocket_tts import TTSModel

        quantize = self._plan.quantize and self._device == "cpu"
        try:
            tts = TTSModel.load_model(language=POCKET_LANGUAGES[language], quantize=quantize)
        except Exception as exc:  # torchao missing or an unsupported CPU
            if not quantize:
                raise
            _log("int8 quantization failed ({}); loading in float32".format(exc))
            tts = TTSModel.load_model(language=POCKET_LANGUAGES[language])
        # pocket_tts pins torch to one thread at import; the plan decides.
        apply_threads(self._plan)
        if self._device == "cuda":
            tts.to("cuda")
        self._models[language] = tts
        return tts

    def _state(self, language: str, voice_id: str):
        key = (language, voice_id)
        existing = self._states.get(key)
        if existing is not None:
            return existing
        state = self._model(language).get_state_for_audio_prompt(voice_id)
        self._states[key] = state
        return state
