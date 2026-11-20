"""Zyphra ZONOS3-Mini adapter, through Zyphra's own MLX server.

The MLX server is the only ZONOS3 runtime that needs no build toolchain, and it
is the fast one on Apple Silicon: the quantized backbone runs on the GPU with
Metal. Rather than a second process, the adapter builds the server's app inside
this sidecar and serves it on a loopback socket from a thread, so the server
lives and dies with the sidecar and no orphan can outlive Terax. Synthesis is a
plain `/v2/generate` call to it.

Only the files speech needs are downloaded: the quantized backbone, the compact
decoder, the speaker encoder and the steering bundle (about 1.2 GB). The 5.5 GB
raw-reference encoders stay out, so a sample is cloned through its speaker
embedding, which the speaker encoder computes.
"""

from __future__ import annotations

import base64
import io
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import wave
from typing import Optional

from .base import MODELS, ZONOS3_LANGUAGES, ZONOS3_VOICES, Engine
from .plan import load_plan

MODEL_ID = "zonos3-mini"
REPO_ID = "Zyphra/ZONOS3-Mini"
BACKBONE = "gguf/backbone-ptq.gguf"
VOICES_DIR = "gguf/voices"
ALLOW_PATTERNS = (
    "gguf/backbone-ptq.gguf",
    "gguf/zac-keep2.gguf",
    "gguf/spk-encoder.gguf",
    "gguf/steer.gguf",
    "gguf/voices/*",
    "gguf/voices/*/*",
)
# The Reader asks for one sentence at a time and prefetches the next one, so two
# slots keep both in flight without reserving memory for the default four.
BATCH = 2
READY_TIMEOUT_S = 300.0
REQUEST_TIMEOUT_S = 600.0
VOICE_IDS = frozenset(v.id for v in ZONOS3_VOICES)


def _log(message: str) -> None:
    sys.stderr.write("[tts] {}\n".format(message))
    sys.stderr.flush()


def build_request(text: str, language: str, voice: Optional[str], sample_path: Optional[str], params: dict) -> dict:
    """The `/v2/generate` body for one sentence."""
    body = {
        "text": text,
        "language": ZONOS3_LANGUAGES[language],
        "stream": False,
        "format": "wav",
    }
    if sample_path:
        with open(sample_path, "rb") as handle:
            body["speaker_audio_base64"] = base64.b64encode(handle.read()).decode("ascii")
        body["speaker_audio_name"] = os.path.basename(sample_path)
        body["speaker_mode"] = "embedding"
    elif voice:
        if voice not in VOICE_IDS:
            raise ValueError("unknown zonos3 voice: {}".format(voice))
        body["speaker_embedding_id"] = voice
    if "temperature" in params:
        body["temperature"] = float(params["temperature"])
    return body


def decode_wav(data: bytes) -> tuple:
    """16-bit PCM WAV bytes to (float32 mono samples, sample rate)."""
    import numpy as np

    with wave.open(io.BytesIO(data), "rb") as reader:
        rate = reader.getframerate()
        channels = reader.getnchannels()
        width = reader.getsampwidth()
        frames = reader.readframes(reader.getnframes())
    if width != 2:
        raise RuntimeError("zonos3 returned {}-byte samples".format(width))
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


class Zonos3Engine(Engine):
    id = "zonos3"

    def __init__(self) -> None:
        self._plan = load_plan()
        self._server = None
        self._thread: Optional[threading.Thread] = None
        self._port: Optional[int] = None

    def models(self) -> list:
        return [m for m in MODELS if m.engine == self.id]

    def voices(self, model: str) -> list:
        return list(ZONOS3_VOICES)

    def effective_device(self) -> Optional[str]:
        return "mlx" if self._server is not None else None

    def load(self, model: str, device: str) -> None:
        if model != MODEL_ID:
            raise ValueError("zonos3 cannot load {}".format(model))
        if self._server is not None:
            return
        from huggingface_hub import snapshot_download

        root = snapshot_download(repo_id=REPO_ID, allow_patterns=list(ALLOW_PATTERNS), local_files_only=True)
        backbone = os.path.join(root, BACKBONE)
        voices = os.path.join(root, VOICES_DIR)
        if not os.path.isfile(backbone):
            raise RuntimeError("the ZONOS3 backbone is missing; download the model again")
        app = self._build_app(backbone, voices)
        self._serve(app)

    def _build_app(self, backbone: str, voices: str):
        # The same assembly as `python -m zonos3_mlx`, minus the studio, the
        # aligner and the plugins, which reading aloud never uses.
        from pathlib import Path

        from zonos3.tokenizer.textnorm import load_normalizer
        from zonos3.tts.edit_align import FuseAlignWorker
        from zonos3.tts.stream import StreamSettings
        from zonos3_mlx.engine import Engine as MlxEngine
        from zonos3_mlx.scheduler import Scheduler
        from zonos3_mlx.server.app import create_app
        from zonos3_mlx.server.state import ServerOptions, ServerState

        # Companions (decoder, speaker encoder, steering) are found next to the
        # backbone; frame limits and idle unloading keep the server's defaults.
        engine = MlxEngine.load(backbone, normalizer=load_normalizer())
        options = ServerOptions(
            model_path=backbone,
            batch=BATCH,
            default_voices_dir=Path(voices) if os.path.isdir(voices) else None,
            studio_dir=None,
            phoneme_lexicon=None,
            prefix=StreamSettings.from_env(),
            fusealign=False,
            plugins=(),
        )
        scheduler = Scheduler(engine, batch=BATCH)
        state = ServerState(engine, scheduler, options, aligner=FuseAlignWorker(python=sys.executable))
        scheduler.start()
        return create_app(state)

    def _serve(self, app) -> None:
        import uvicorn

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 0))
        self._port = sock.getsockname()[1]
        config = uvicorn.Config(app, log_level="warning", access_log=False)
        server = uvicorn.Server(config)
        # The sidecar owns signals; uvicorn must not install its own handlers
        # from a non-main thread.
        server.install_signal_handlers = lambda: None
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        thread.start()
        self._server = server
        self._thread = thread
        deadline = time.monotonic() + READY_TIMEOUT_S
        while time.monotonic() < deadline:
            if not thread.is_alive():
                raise RuntimeError("the ZONOS3 server stopped while starting")
            try:
                with urllib.request.urlopen(self._url("/v2/health"), timeout=5) as reply:
                    if reply.status == 200:
                        _log("zonos3 MLX server ready on 127.0.0.1:{}".format(self._port))
                        return
            except (urllib.error.URLError, OSError):
                time.sleep(0.5)
        raise RuntimeError("the ZONOS3 server did not start within {}s".format(int(READY_TIMEOUT_S)))

    def _url(self, path: str) -> str:
        return "http://127.0.0.1:{}{}".format(self._port, path)

    def unload(self) -> None:
        server = self._server
        self._server = None
        if server is not None:
            server.should_exit = True
            if self._thread is not None:
                self._thread.join(timeout=10)
        self._thread = None
        self._port = None

    def synthesize(
        self,
        model: str,
        text: str,
        language: str,
        voice: Optional[str],
        sample_path: Optional[str],
        params: dict,
    ) -> tuple:
        if self._server is None:
            raise RuntimeError("zonos3 is not loaded")
        body = json.dumps(build_request(text, language, voice, sample_path, params)).encode("utf-8")
        request = urllib.request.Request(
            self._url("/v2/generate"),
            data=body,
            headers={"Content-Type": "application/json", "Accept": "audio/wav"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as reply:
                data = reply.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:400].decode("utf-8", "replace")
            raise RuntimeError("zonos3 refused the request ({}): {}".format(exc.code, detail))
        return decode_wav(data)
