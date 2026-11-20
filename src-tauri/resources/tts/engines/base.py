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

LANGUAGES = ("es-ES", "en-US", "fr-FR", "de-DE", "it-IT", "pt-BR")
KOKORO_LANGUAGES = ("es-ES", "en-US", "fr-FR", "it-IT", "pt-BR")

PARAM_RANGES = {
    "speed": (0.5, 2.0),
    "exaggeration": (0.0, 2.0),
    "cfgWeight": (0.0, 1.0),
    "temperature": (0.05, 2.0),
    "steps": (4.0, 64.0),
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


# Every chatterbox checkpoint ships a `conds.pt`: a speaker the model falls back
# to when no audio prompt is given. It is the only voice a clone model owns, so
# it needs no sample and works in every language the model supports.
BUILTIN_VOICE_ID = "builtin"


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
    #: Id of the voice baked into the weights, empty when there is none.
    builtin_voice: str = ""
    #: Voices a clone model speaks without a sample (VoiceInfo), besides
    #: `builtin_voice`; for a preset model, its whole catalogue.
    preset_voices: tuple = ()
    #: Files (relative to a snapshot) every download must have produced.
    required_files: tuple = ()


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
        languages=KOKORO_LANGUAGES,
        voice_source="preset",
        sample_rate=24000,
        params=("speed",),
    ),
    ModelInfo(
        id="chatterbox-multilingual",
        engine="chatterbox",
        repo="ResembleAI/chatterbox",
        languages=LANGUAGES,
        voice_source="clone",
        sample_rate=24000,
        params=("exaggeration", "cfgWeight", "temperature"),
        builtin_voice=BUILTIN_VOICE_ID,
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
        builtin_voice=BUILTIN_VOICE_ID,
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
        builtin_voice=BUILTIN_VOICE_ID,
    ),
    ModelInfo(
        id="pocket-tts",
        engine="pocket",
        repo="kyutai/pocket-tts-without-voice-cloning",
        languages=LANGUAGES,
        voice_source="preset",
        sample_rate=24000,
        required_files=(
            "languages/english/model.safetensors",
            "languages/spanish/model.safetensors",
        ),
    ),
    ModelInfo(
        id="omnivoice",
        engine="omnivoice",
        repo="k2-fsa/OmniVoice",
        languages=LANGUAGES,
        voice_source="clone",
        sample_rate=24000,
        params=("speed", "steps"),
        required_files=("model.safetensors", "audio_tokenizer/model.safetensors"),
    ),
    ModelInfo(
        id="zonos3-mini",
        engine="zonos3",
        repo="Zyphra/ZONOS3-Mini",
        languages=LANGUAGES,
        voice_source="clone",
        sample_rate=44100,
        params=("temperature",),
        required_files=(
            "gguf/backbone-ptq.gguf",
            "gguf/zac-keep2.gguf",
            "gguf/spk-encoder.gguf",
        ),
    ),
    ModelInfo(
        id="fake-model",
        engine="fake",
        repo="",
        languages=LANGUAGES,
        voice_source="preset",
        sample_rate=24000,
        params=("speed",),
    ),
)

# Pocket TTS ships one precomputed state per voice for every language model, so
# any voice reads either language; the list per language puts the native
# speakers first.
POCKET_VOICES = (
    VoiceInfo("lola", "Lola (Spanish)", "es-ES"),
    VoiceInfo("rafael", "Rafael (Portuguese)", "es-ES"),
    VoiceInfo("giovanni", "Giovanni (Italian)", "es-ES"),
    VoiceInfo("estelle", "Estelle (French)", "es-ES"),
) + tuple(
    VoiceInfo(name, name.replace("_", " ").title(), "en-US")
    for name in (
        "alba", "marius", "javert", "jean", "fantine", "cosette", "eponine",
        "azelma", "anna", "vera", "charles", "paul", "george", "mary", "jane",
        "michael", "eve", "bill_boerst", "peter_yearsley", "stuart_bell", "caro_davy",
    )
)
POCKET_VOICES = POCKET_VOICES + (
    VoiceInfo("estelle", "Estelle (French)", "fr-FR"),
    VoiceInfo("giovanni", "Giovanni (Italian)", "fr-FR"),
    VoiceInfo("rafael", "Rafael (Portuguese)", "fr-FR"),
    VoiceInfo("juergen", "Juergen (German)", "de-DE"),
    VoiceInfo("estelle", "Estelle (French)", "de-DE"),
    VoiceInfo("giovanni", "Giovanni (Italian)", "it-IT"),
    VoiceInfo("rafael", "Rafael (Portuguese)", "it-IT"),
    VoiceInfo("rafael", "Rafael (Portuguese)", "pt-BR"),
    VoiceInfo("giovanni", "Giovanni (Italian)", "pt-BR"),
)
POCKET_DEFAULT_VOICES = {
    "es-ES": "lola",
    "en-US": "alba",
    "fr-FR": "estelle",
    "de-DE": "juergen",
    "it-IT": "giovanni",
    "pt-BR": "rafael",
}
POCKET_LANGUAGES = {
    "es-ES": "spanish",
    "en-US": "english",
    "fr-FR": "french",
    "de-DE": "german",
    "it-IT": "italian",
    "pt-BR": "portuguese",
}
# The install downloads these; the other languages download on first use.
POCKET_PREFETCHED = ("es-ES", "en-US")

# OmniVoice speaks without a sample in two ways: it picks a voice itself, or it
# designs one from attributes. Voice design was trained on English and Chinese
# only, so the Spanish ones leave accents out and are the less predictable.
OMNIVOICE_AUTO_VOICE = "auto"
OMNIVOICE_DESIGNS = {
    "design-f-young": "female, young adult, moderate pitch",
    "design-m-middle": "male, middle-aged, low pitch",
    "design-f-elderly": "female, elderly, moderate pitch",
    "design-m-young": "male, young adult, moderate pitch",
    "design-f-american": "female, young adult, moderate pitch, american accent",
    "design-m-american": "male, middle-aged, low pitch, american accent",
    "design-f-british": "female, middle-aged, moderate pitch, british accent",
    "design-m-british": "male, young adult, moderate pitch, british accent",
    "design-f-whisper": "female, young adult, whisper",
}
OMNIVOICE_VOICES = (
    VoiceInfo(OMNIVOICE_AUTO_VOICE, "Automatic", "es-ES"),
    VoiceInfo("design-f-young", "Designed: young woman", "es-ES"),
    VoiceInfo("design-m-middle", "Designed: middle-aged man, low", "es-ES"),
    VoiceInfo("design-f-elderly", "Designed: elderly woman", "es-ES"),
    VoiceInfo("design-m-young", "Designed: young man", "es-ES"),
    VoiceInfo(OMNIVOICE_AUTO_VOICE, "Automatic", "en-US"),
    VoiceInfo("design-f-american", "Designed: American woman", "en-US"),
    VoiceInfo("design-m-american", "Designed: American man, low", "en-US"),
    VoiceInfo("design-f-british", "Designed: British woman", "en-US"),
    VoiceInfo("design-m-british", "Designed: British man", "en-US"),
    VoiceInfo("design-f-whisper", "Designed: whispering woman", "en-US"),
) + tuple(
    VoiceInfo(voice_id, label, language)
    for language in ("fr-FR", "de-DE", "it-IT", "pt-BR")
    for voice_id, label in (
        (OMNIVOICE_AUTO_VOICE, "Automatic"),
        ("design-f-young", "Designed: young woman"),
        ("design-m-middle", "Designed: middle-aged man, low"),
        ("design-f-elderly", "Designed: elderly woman"),
        ("design-m-young", "Designed: young man"),
    )
)
OMNIVOICE_LANGUAGES = {"es-ES": "es", "en-US": "en", "fr-FR": "fr", "de-DE": "de", "it-IT": "it", "pt-BR": "pt"}

# ZONOS3-Mini default voices: the ids `GET /v2/speakers` returns for the
# gguf/voices folder of the pinned weights.
ZONOS3_VOICES = (
    VoiceInfo("default_43e790fc116fd62a", "Ximena", "es-ES"),
    VoiceInfo("default_87250baa043e5bba", "Rodrigo", "es-ES"),
    VoiceInfo("default_de4d191ca7574982", "Savannah (American)", "en-US"),
    VoiceInfo("default_34370fd91e3484ef", "Wyatt (American)", "en-US"),
    VoiceInfo("default_b78b28baf5c31a1d", "Imogen (British)", "en-US"),
    VoiceInfo("default_3765f0d1140c05c0", "Rupert (British)", "en-US"),
    VoiceInfo("default_2c5123a959875341", "Cillian (Irish)", "en-US"),
    VoiceInfo("default_3c00e421e684f949", "Thaddeus (announcer)", "en-US"),
    VoiceInfo("default_c95cf57259ed7313", "Jett (energetic)", "en-US"),
    VoiceInfo("default_940eaff39a929da0", "Willow (ASMR)", "en-US"),
    VoiceInfo("default_40a3ba1017bfb68a", "Morgana (witch)", "en-US"),
    VoiceInfo("default_c5e098c322aae901", "Sakura (anime)", "en-US"),
    VoiceInfo("default_517319c805b927e9", "Gaspard", "fr-FR"),
    VoiceInfo("default_09d206a5b067ae71", "Liesel", "de-DE"),
    VoiceInfo("default_ec650ef042ed1f14", "Wolfgang", "de-DE"),
    VoiceInfo("default_792987ff6236e50d", "Ginevra", "it-IT"),
    VoiceInfo("default_ccb71e6596453e72", "Lorenzo", "it-IT"),
    VoiceInfo("default_e11f53895cad62fa", "Leonor", "pt-BR"),
    VoiceInfo("default_4562e98e005b69cc", "Thiago", "pt-BR"),
)
# Server codes from zonos3/registries/languages.json at the pinned commit.
ZONOS3_LANGUAGES = {"es-ES": "es", "en-US": "en_us", "fr-FR": "fr_fr", "de-DE": "de", "it-IT": "it", "pt-BR": "pt_br"}

_PRESETS_BY_MODEL = {
    "pocket-tts": POCKET_VOICES,
    "omnivoice": OMNIVOICE_VOICES,
    "zonos3-mini": ZONOS3_VOICES,
}
MODELS = tuple(
    ModelInfo(**{**m.__dict__, "preset_voices": _PRESETS_BY_MODEL.get(m.id, m.preset_voices)})
    for m in MODELS
)

MODELS_BY_ID = {m.id: m for m in MODELS}


def sample_free_voices(info: ModelInfo, language: str) -> frozenset:
    """Voice ids a clone model speaks in `language` without a sample."""
    ids = {v.id for v in info.preset_voices if v.language == language}
    if info.builtin_voice:
        ids.add(info.builtin_voice)
    return frozenset(ids)

KOKORO_LANG_CODES = {"es-ES": "e", "en-US": "a", "fr-FR": "f", "it-IT": "i", "pt-BR": "p"}
CHATTERBOX_LANG_IDS = {"es-ES": "es", "en-US": "en", "fr-FR": "fr", "de-DE": "de", "it-IT": "it", "pt-BR": "pt"}

# lang_code, region label, sex suffix, given names.
_KOKORO_PRESETS = (
    ("a", "American", "f", ("alloy", "aoede", "bella", "heart", "jessica", "kore", "nicole", "nova", "river", "sarah", "sky")),
    ("a", "American", "m", ("adam", "echo", "eric", "fenrir", "liam", "michael", "onyx", "puck", "santa")),
    ("b", "British", "f", ("alice", "emma", "isabella", "lily")),
    ("b", "British", "m", ("daniel", "fable", "george", "lewis")),
    ("e", "Spanish", "f", ("dora",)),
    ("e", "Spanish", "m", ("alex", "santa")),
    ("f", "French", "f", ("siwis",)),
    ("i", "Italian", "f", ("sara",)),
    ("i", "Italian", "m", ("nicola",)),
    ("p", "Brazilian", "f", ("dora",)),
    ("p", "Brazilian", "m", ("alex", "santa")),
)
_KOKORO_CODE_LANGUAGE = {"a": "en-US", "b": "en-US", "e": "es-ES", "f": "fr-FR", "i": "it-IT", "p": "pt-BR"}


def _kokoro_voices() -> tuple:
    out = []
    for code, region, sex, names in _KOKORO_PRESETS:
        language = _KOKORO_CODE_LANGUAGE[code]
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
KOKORO_DEFAULT_VOICES = {
    "es-ES": "ef_dora",
    "en-US": "af_heart",
    "fr-FR": "ff_siwis",
    "it-IT": "if_sara",
    "pt-BR": "pf_dora",
}


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
        if _KOKORO_CODE_LANGUAGE.get(code) == language:
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
            revisions = [entry.path for entry in entries if entry.is_dir()]
    except OSError:
        return False
    if not revisions:
        return False
    # Pocket TTS pins each file to its own revision, so a required file may
    # sit in any snapshot.
    return all(
        any(os.path.isfile(os.path.join(rev, rel)) for rev in revisions)
        for rel in info.required_files
    )


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
