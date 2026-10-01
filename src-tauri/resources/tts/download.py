#!/usr/bin/env python3
"""Download one model (or a whole engine's models) into the HF cache.

HF_HOME and HF_HUB_CACHE come from the parent process; this script never
sets them. Progress lines go to stdout as one JSON object per line.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engines.base import MODELS, model_info  # noqa: E402

# File names verified against the HF repos; anything not listed is skipped.
ALLOW_PATTERNS = {
    "kokoro-82m": ("kokoro-v1_0.pth", "config.json", "voices/*.pt"),
    # Exactly what ChatterboxMultilingualTTS.from_local reads for t3_model="v3".
    # The repo also carries ve.safetensors and s3gen_v3.safetensors, which the
    # library never opens: listing those downloaded gigabytes the loader would
    # then re-fetch as ve.pt and s3gen.pt.
    "chatterbox-multilingual": (
        "t3_mtl23ls_v3.safetensors",
        "s3gen.pt",
        "ve.pt",
        "conds.pt",
        "grapheme_mtl_merged_expanded_v1.json",
        "Cangjie5_TC.json",
    ),
    "chatterbox-turbo": None,
    "chatterbox-nano": None,
}
IGNORE_PATTERNS = ("*.md", ".gitattributes")


def emit(progress: float, message: str) -> None:
    sys.stdout.write(json.dumps({"progress": round(progress, 4), "message": message}) + "\n")
    sys.stdout.flush()


def targets(model: str, engine: str) -> list:
    if model:
        info = model_info(model)
        if info is None or not info.repo:
            raise SystemExit("unknown model: {}".format(model))
        if engine and info.engine != engine:
            raise SystemExit("{} does not belong to engine {}".format(model, engine))
        return [info]
    if engine:
        found = [m for m in MODELS if m.engine == engine and m.repo]
        if not found:
            raise SystemExit("unknown engine: {}".format(engine))
        return found
    raise SystemExit("--model or --engine is required")


def download(info) -> str:
    from huggingface_hub import snapshot_download

    allow = ALLOW_PATTERNS.get(info.id)
    return snapshot_download(
        repo_id=info.repo,
        allow_patterns=list(allow) if allow else None,
        ignore_patterns=None if allow else list(IGNORE_PATTERNS),
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Download Terax TTS model weights")
    parser.add_argument("--model", default="")
    parser.add_argument("--engine", default="")
    args = parser.parse_args(argv)

    wanted = targets(args.model, args.engine)
    total = len(wanted)
    emit(0.0, "downloading {} model(s)".format(total))
    for index, info in enumerate(wanted):
        emit(index / total, "fetching {} from {}".format(info.id, info.repo))
        try:
            path = download(info)
        except Exception as exc:
            sys.stderr.write("[tts] download failed for {}: {}\n".format(info.id, exc))
            sys.stderr.flush()
            emit((index + 1) / total, "failed: {}".format(info.id))
            return 1
        emit((index + 1) / total, "ready: {} at {}".format(info.id, path))
    emit(1.0, "done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
