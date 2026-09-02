"""Engine interface plus the shared model, language and voice metadata.

The tables here are the single source of truth for the sidecar; Rust and the
frontend mirror them as closed enums (see docs/plans/2026-09-02-local-tts.md).
"""

from __future__ import annotations

import abc
import array
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, Optional

LANGUAGES = ("es-ES", "en-US")

PARAM_RANGES = {
    "speed": (0.5, 2.0),
    "exaggeration": (0.0, 2.0),
    "cfgWeight": (0.0, 1.0),
    "temperature": (0.05, 2.0),
}

# Documented for Turbo and Nano. The README covers [laugh], [cough] and
# [chuckle]; the rest exist in the tokenizer with no quality guarantee.
PARALINGUISTIC_TAGS = (
    "[advertisement]",
    "[angry]",
    "[chuckle]",
    "[clear throat]",
    "[cough]",
    "[crying]",
    "[dramatic]",
    "[fear]",
    "[gasp]",
    "[groan]",
    "[happy]",
    "[laugh]",
    "[narration]",
    "[sarcastic]",
    "[shush]",
    "[sigh]",
    "[sniff]",
    "[surprised]",
    "[whispering]",
)


@dataclass(frozen=True)
class ModelInfo:
    id: str
    engine: str
    repo: str
    languages: tuple
    voice_source: str
    sample_rate: int
    params: tuple = ()
    tags: tuple = ()


@dataclass(frozen=True)
class VoiceInfo:
    id: str
    label: str
    language: str


MODELS = (
    ModelInfo(
        id="kokoro-82m",
        engine="kokoro",
        repo="hexgrad/Kokoro-82M",
        languages=("es-ES", "en-US"),
        voice_source="preset",
        sample_rate=24000,
        params=("speed",),
    ),
    ModelInfo(
        id="chatterbox-multilingual",
        engine="chatterbox",
        repo="ResembleAI/chatterbox",
        languages=("es-ES", "en-US"),
        voice_source="clone",
        sample_rate=24000,
        params=("exaggeration", "cfgWeight", "temperature"),
    ),
    ModelInfo(
        id="chatterbox-turbo",
        engine="chatterbox",
        repo="ResembleAI/chatterbox-turbo",
        languages=("en-US",),
        voice_source="clone",
        sample_rate=24000,
        params=("exaggeration", "cfgWeight", "temperature"),
        tags=PARALINGUISTIC_TAGS,
    ),
    ModelInfo(
        id="chatterbox-nano",
        engine="chatterbox",
        repo="ResembleAI/chatterbox-nano",
        languages=("en-US",),
        voice_source="clone",
        sample_rate=24000,
        params=("exaggeration", "cfgWeight", "temperature"),
        tags=PARALINGUISTIC_TAGS,
    ),
    ModelInfo(
        id="fake-model",
        engine="fake",
        repo="",
        languages=("es-ES", "en-US"),
        voice_source="preset",
        sample_rate=24000,
        params=("speed",),
    ),
)

MODELS_BY_ID = {m.id: m for m in MODELS}

KOKORO_LANG_CODES = {"es-ES": "e", "en-US": "a"}
CHATTERBOX_LANG_IDS = {"es-ES": "es", "en-US": "en"}

# lang_code, region label, sex suffix, given names.
_KOKORO_PRESETS = (
    ("a", "American", "f", ("alloy", "aoede", "bella", "heart", "jessica", "kore", "nicole", "nova", "river", "sarah", "sky")),
    ("a", "American", "m", ("adam", "echo", "eric", "fenrir", "liam", "michael", "onyx", "puck", "santa")),
    ("b", "British", "f", ("alice", "emma", "isabella", "lily")),
    ("b", "British", "m", ("daniel", "fable", "george", "lewis")),
    ("e", "Spanish", "f", ("dora",)),
    ("e", "Spanish", "m", ("alex", "santa")),
)


def _kokoro_voices() -> tuple:
    out = []
    for code, region, sex, names in _KOKORO_PRESETS:
        language = "es-ES" if code == "e" else "en-US"
        for name in names:
            out.append(
                VoiceInfo(
                    id="{}{}_{}".format(code, sex, name),
                    label="{} {} ({})".format(region, name.capitalize(), sex),
                    language=language,
                )
            )
    return tuple(out)


KOKORO_VOICES = _kokoro_voices()
KOKORO_VOICE_IDS = frozenset(v.id for v in KOKORO_VOICES)
KOKORO_DEFAULT_VOICES = {"es-ES": "ef_dora", "en-US": "af_heart"}


def model_info(model_id: str) -> Optional[ModelInfo]:
    return MODELS_BY_ID.get(model_id)


def kokoro_lang_code(language: str, voice: Optional[str]) -> str:
    """Prefer the voice prefix so British presets phonemize as British.

    Kokoro warns and mispronounces when the voice prefix and the pipeline
    lang_code disagree, so `bf_emma` under en-US uses lang_code "b".
    """
    default = KOKORO_LANG_CODES[language]
    head = (voice or "").split(",")[0].strip()
    if len(head) >= 2 and head[1] in ("f", "m"):
        code = head[0]
        if code == "e" and language == "es-ES":
            return "e"
        if code in ("a", "b") and language == "en-US":
            return code
    return default


_SENTENCE = re.compile(r"[^.!?\u2026]*[.!?\u2026]+[\"'\)\]\u00bb]*\s*|[^.!?\u2026]+$")


def collapse_whitespace(text: str) -> str:
    return " ".join(text.split())


def _hard_split(piece: str, max_chars: int) -> list:
    parts = []
    pending = ""
    for fragment in re.split(r"(?<=[,;:])\s+", piece):
        candidate = (pending + " " + fragment).strip() if pending else fragment
        if len(candidate) <= max_chars:
            pending = candidate
            continue
        if pending:
            parts.append(pending)
        pending = ""
        while len(fragment) > max_chars:
            cut = fragment.rfind(" ", 0, max_chars)
            if cut <= 0:
                cut = max_chars
            parts.append(fragment[:cut].strip())
            fragment = fragment[cut:].strip()
        pending = fragment
    if pending:
        parts.append(pending)
    return [p for p in parts if p]


def split_sentences(text: str, max_chars: int) -> list:
    """Sentence-aware packing into chunks of at most max_chars characters."""
    normalized = collapse_whitespace(text)
    if not normalized:
        return []
    if max_chars <= 0:
        return [normalized]
    chunks = []
    pending = ""
    for raw in _SENTENCE.findall(normalized):
        sentence = raw.strip()
        if not sentence:
            continue
        if len(sentence) > max_chars:
            if pending:
                chunks.append(pending)
                pending = ""
            chunks.extend(_hard_split(sentence, max_chars))
            continue
        candidate = (pending + " " + sentence) if pending else sentence
        if len(candidate) <= max_chars:
            pending = candidate
        else:
            chunks.append(pending)
            pending = sentence
    if pending:
        chunks.append(pending)
    return chunks


def hf_hub_cache() -> str:
    cache = os.environ.get("HF_HUB_CACHE")
    if cache:
        return cache
    home = os.environ.get("HF_HOME")
    if home:
        return os.path.join(home, "hub")
    return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def is_downloaded(info: ModelInfo) -> bool:
    if not info.repo:
        return True
    folder = "models--" + info.repo.replace("/", "--")
    snapshots = os.path.join(hf_hub_cache(), folder, "snapshots")
    if not os.path.isdir(snapshots):
        return False
    try:
        with os.scandir(snapshots) as entries:
            return any(entry.is_dir() for entry in entries)
    except OSError:
        return False


def to_pcm16_bytes(samples: Any) -> bytes:
    """Float32 mono to little-endian int16 PCM, clipping out-of-range values."""
    if hasattr(samples, "astype"):
        import numpy as np

        clipped = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0)
        return (clipped * 32767.0).astype("<i2").tobytes()
    out = array.array("h", (max(-32768, min(32767, int(v * 32767.0))) for v in samples))
    if sys.byteorder == "big":
        out.byteswap()
    return out.tobytes()


class Engine(abc.ABC):
    """One resident model per process; load() replaces whatever was loaded."""

    id = ""

    @abc.abstractmethod
    def models(self) -> list:
        raise NotImplementedError

    @abc.abstractmethod
    def load(self, model: str, device: str) -> None:
        raise NotImplementedError

    @abc.abstractmethod
    def unload(self) -> None:
        raise NotImplementedError

    @abc.abstractmethod
    def voices(self, model: str) -> list:
        raise NotImplementedError

    @abc.abstractmethod
    def synthesize(
        self,
        model: str,
        text: str,
        language: str,
        voice: Optional[str],
        sample_path: Optional[str],
        params: dict,
    ) -> tuple:
        raise NotImplementedError

    def effective_device(self) -> Optional[str]:
        return None
