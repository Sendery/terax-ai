#!/usr/bin/env python3
"""Loopback TTS sidecar. Standard library only; engines own their deps.

Contract: docs/plans/2026-09-02-local-tts.md, "Sidecar HTTP API", and for
dictation engines docs/plans/2026-11-21-local-dictation.md ("/transcribe").
"""

from __future__ import annotations

import argparse
import hmac
import io
import json
import os
import sys
import threading
import time
import wave
from array import array
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engines import create_engine  # noqa: E402
from engines.base import (  # noqa: E402
    LANGUAGES,
    PARAM_RANGES,
    ISOLATE_MAX_RATE,
    ISOLATE_MIN_RATE,
    TRANSCRIPTION_SAMPLE_RATE,
    is_downloaded,
    collapse_whitespace,
    model_info,
    sample_free_voices,
    to_pcm16_bytes,
)

MAX_BODY_BYTES = 64 * 1024
# Ten minutes of 16 kHz mono 16-bit audio plus its header.
MAX_AUDIO_BYTES = 20 * 1024 * 1024
MAX_CONTEXT_CHARS = 2000
CONTEXT_HEADER = "X-Terax-Context"
# Under a tenth of a second there is nothing to transcribe.
MIN_TRANSCRIBE_FRAMES = TRANSCRIPTION_SAMPLE_RATE // 10
TRANSCRIBE_PARAMS = ("model", "language", "filler", "verbatim", "digits")
TRANSCRIBE_DEFAULTS = {"filler": False, "verbatim": True, "digits": True}
SELF_TEST_SECONDS = 1
ISOLATE_PARAMS = ("model",)
# Under 20 ms there is nothing to clean; the clip is returned as sent.
MIN_ISOLATE_MS = 20
MAX_TEXT_CHARS = 8192
MIN_TOKEN_CHARS = 16
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


class HttpError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class Host:
    """Owns the resident model. Synthesis is serialised; loads are exclusive."""

    def __init__(self, engine_name: str, device: str, samples_dir: str) -> None:
        self.engine_name = engine_name
        self.device = device
        self.samples_dir = samples_dir
        self.engine = create_engine(engine_name)
        self._state = threading.Lock()
        self._work = threading.Lock()
        self._loading = False
        self._loaded = None

    @property
    def loaded_model(self):
        with self._state:
            return self._loaded

    def effective_device(self) -> str:
        return self.engine.effective_device() or self.device

    def _begin_load(self, model: str) -> bool:
        with self._state:
            if self._loading:
                raise HttpError(503, "loading", "a model is loading")
            if self._loaded == model:
                return False
            self._loading = True
            return True

    def _ensure_loaded(self, model: str) -> None:
        if not self._begin_load(model):
            return
        try:
            if self._loaded is not None:
                self.engine.unload()
                with self._state:
                    self._loaded = None
            self.engine.load(model, self.device)
            with self._state:
                self._loaded = model
        except HttpError:
            raise
        except (Exception, SystemExit) as exc:
            log("load failed for {}: {}".format(model, exc))
            raise HttpError(500, "load_failed", "could not load {}".format(model))
        finally:
            with self._state:
                self._loading = False

    def _guard_loading(self) -> None:
        with self._state:
            if self._loading:
                raise HttpError(503, "loading", "a model is loading")

    def warmup(self, model: str) -> None:
        self._guard_loading()
        with self._work:
            self._ensure_loaded(model)

    def synthesize(self, request: dict) -> tuple:
        self._guard_loading()
        with self._work:
            self._ensure_loaded(request["model"])
            try:
                return self.engine.synthesize(
                    request["model"],
                    request["text"],
                    request["language"],
                    request["voice"],
                    request["samplePath"],
                    request["params"],
                )
            except HttpError:
                raise
            except (Exception, SystemExit) as exc:
                log("synthesis failed: {}".format(exc))
                raise HttpError(500, "synthesis_failed", "synthesis failed")

    @property
    def kind(self) -> str:
        return getattr(self.engine, "kind", "speech")

    def transcribe(self, request: dict) -> dict:
        self._guard_loading()
        with self._work:
            self._ensure_loaded(request["model"])
            try:
                return self.engine.transcribe(
                    request["model"],
                    request["pcm"],
                    request["language"],
                    request["context"],
                    request["options"],
                )
            except HttpError:
                raise
            except (Exception, SystemExit) as exc:
                log("transcription failed: {}".format(exc))
                raise HttpError(500, "transcription_failed", "transcription failed")

    def isolate(self, model: str, pcm, sample_rate: int):
        self._guard_loading()
        with self._work:
            self._ensure_loaded(model)
            try:
                return self.engine.isolate(model, pcm, sample_rate)
            except HttpError:
                raise
            except (Exception, SystemExit) as exc:
                log("isolation failed: {}".format(exc))
                raise HttpError(500, "isolation_failed", "isolation failed")

    def self_test(self, model: str) -> dict:
        """One second of silence must come back empty: the model loads, runs,
        and does not invent words."""
        started = time.monotonic()
        silence = array("h", bytes(2 * TRANSCRIPTION_SAMPLE_RATE * SELF_TEST_SECONDS))
        try:
            result = self.transcribe(
                {"model": model, "pcm": silence, "language": None, "context": None,
                 "options": dict(TRANSCRIBE_DEFAULTS)}
            )
            ok = not (result.get("text") or "").strip()
        except HttpError as error:
            log("self-test failed: {}".format(error.message))
            ok = False
        elapsed = int((time.monotonic() - started) * 1000)
        log("self-test {} in {} ms".format("passed" if ok else "FAILED", elapsed))
        return {"ok": ok, "elapsedMs": elapsed}

    def close(self) -> None:
        try:
            self.engine.unload()
        except Exception as exc:
            log("unload failed: {}".format(exc))


def log(message: str) -> None:
    # Terax reads stderr; once it is gone the pipe is broken, and a log line
    # must never be the thing that stops the sidecar from shutting down.
    try:
        sys.stderr.write("[tts] {}\n".format(message))
        sys.stderr.flush()
    except (OSError, ValueError):
        pass


def _empty_wav(sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
    return buffer.getvalue()


def encode_wav(samples, sample_rate: int) -> bytes:
    frames = to_pcm16_bytes(samples)
    if not frames:
        raise HttpError(500, "empty_audio", "engine produced no audio")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(frames)
    return buffer.getvalue()


def _require_str(payload: dict, key: str):
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise HttpError(400, "bad_request", "{} must be a string".format(key))
    return value


def validate_params(allowed: tuple, raw) -> dict:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise HttpError(400, "bad_request", "params must be an object")
    out = {}
    for key, value in raw.items():
        if key not in PARAM_RANGES or key not in allowed:
            raise HttpError(400, "unknown_param", "unknown param: {}".format(key))
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise HttpError(400, "param_out_of_range", "{} must be a number".format(key))
        low, high = PARAM_RANGES[key]
        if not low <= float(value) <= high:
            raise HttpError(
                400,
                "param_out_of_range",
                "{} must be between {} and {}".format(key, low, high),
            )
        out[key] = float(value)
    return out


def validate_sample_path(samples_dir: str, raw):
    if raw is None:
        return None
    if not isinstance(raw, str) or not raw:
        raise HttpError(400, "invalid_sample_path", "samplePath must be a path")
    root = os.path.realpath(samples_dir)
    resolved = os.path.realpath(raw)
    if resolved != root and not resolved.startswith(root + os.sep):
        raise HttpError(400, "invalid_sample_path", "samplePath is outside the samples dir")
    if not os.path.isfile(resolved):
        raise HttpError(400, "invalid_sample_path", "samplePath does not exist")
    return resolved


def validate_model(host: Host, raw):
    if not isinstance(raw, str) or not raw:
        raise HttpError(400, "unknown_model", "model is required")
    info = model_info(raw)
    if info is None:
        raise HttpError(400, "unknown_model", "unknown model")
    if info.engine != host.engine_name:
        raise HttpError(400, "wrong_engine", "model belongs to engine {}".format(info.engine))
    return info


def ensure_downloaded(info) -> None:
    """Availability is checked after the request itself is known to be valid."""
    if not is_downloaded(info):
        raise HttpError(404, "model_not_downloaded", "model weights are not downloaded")


def validate_synthesize(host: Host, payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise HttpError(400, "bad_request", "body must be an object")
    info = validate_model(host, payload.get("model"))

    raw_text = payload.get("text")
    if not isinstance(raw_text, str):
        raise HttpError(400, "empty_text", "text is required")
    text = collapse_whitespace(raw_text)
    if not text:
        raise HttpError(400, "empty_text", "text is empty")
    if len(text) > MAX_TEXT_CHARS:
        raise HttpError(400, "text_too_long", "text exceeds {} chars".format(MAX_TEXT_CHARS))

    language = payload.get("language")
    if language not in LANGUAGES:
        raise HttpError(400, "unsupported_language", "language must be one of {}".format(list(LANGUAGES)))
    if language not in info.languages:
        raise HttpError(
            400,
            "unsupported_language_for_model",
            "{} does not support {}".format(info.id, language),
        )

    voice = _require_str(payload, "voice")
    params = validate_params(info.params, payload.get("params"))
    sample_path = validate_sample_path(host.samples_dir, payload.get("samplePath"))
    if info.voice_source == "clone" and sample_path is None:
        # A clone model speaks without a sample only in a voice it owns: the
        # one baked into its weights, or one of its default voices.
        if voice not in sample_free_voices(info, language):
            raise HttpError(400, "sample_required", "{} needs a voice sample".format(info.id))
    if info.voice_source == "preset" and info.preset_voices and voice is not None:
        if voice not in {v.id for v in info.preset_voices}:
            raise HttpError(400, "unknown_voice", "{} has no voice {}".format(info.id, voice))

    known = {"model", "text", "language", "voice", "samplePath", "params"}
    unknown = sorted(set(payload) - known)
    if unknown:
        raise HttpError(400, "bad_request", "unknown field: {}".format(unknown[0]))

    ensure_downloaded(info)

    return {
        "model": info.id,
        "text": text,
        "language": language,
        "voice": voice,
        "samplePath": sample_path,
        "params": params,
    }


def require_kind(host: Host, kind: str) -> None:
    if host.kind != kind:
        raise HttpError(
            409,
            "wrong_kind",
            "engine {} is a {} engine".format(host.engine_name, host.kind),
        )


def parse_flag(name: str, raw: str) -> bool:
    value = raw.strip().lower()
    if value in ("1", "true"):
        return True
    if value in ("0", "false"):
        return False
    raise HttpError(400, "bad_request", "{} must be 0 or 1".format(name))


def validate_context(raw) -> "str | None":
    if raw is None:
        return None
    try:
        text = unquote(raw, encoding="utf-8", errors="strict")
    except UnicodeDecodeError:
        raise HttpError(400, "bad_context", "{} is not URL-encoded UTF-8".format(CONTEXT_HEADER))
    text = collapse_whitespace("".join(ch if ch.isprintable() else " " for ch in text))
    if len(text) > MAX_CONTEXT_CHARS:
        raise HttpError(400, "context_too_long", "context exceeds {} chars".format(MAX_CONTEXT_CHARS))
    return text or None


def decode_pcm_wav(body: bytes) -> array:
    """The int16 frames of a 16 kHz mono 16-bit PCM WAV, else a 400."""
    try:
        with wave.open(io.BytesIO(body), "rb") as reader:
            channels = reader.getnchannels()
            width = reader.getsampwidth()
            rate = reader.getframerate()
            frames = reader.readframes(reader.getnframes())
    except (wave.Error, EOFError):
        raise HttpError(400, "bad_audio", "body must be a PCM WAV file")
    if channels != 1 or width != 2 or rate != TRANSCRIPTION_SAMPLE_RATE:
        raise HttpError(
            400,
            "bad_audio",
            "audio must be mono 16-bit PCM at {} Hz".format(TRANSCRIPTION_SAMPLE_RATE),
        )
    pcm = array("h")
    pcm.frombytes(frames[: len(frames) - (len(frames) % 2)])
    if sys.byteorder == "big":
        pcm.byteswap()
    return pcm


def decode_mono_pcm_wav(body: bytes) -> tuple:
    """The int16 frames and rate of a mono 16-bit PCM WAV between
    ISOLATE_MIN_RATE and ISOLATE_MAX_RATE, else a 400."""
    try:
        with wave.open(io.BytesIO(body), "rb") as reader:
            channels = reader.getnchannels()
            width = reader.getsampwidth()
            rate = reader.getframerate()
            frames = reader.readframes(reader.getnframes())
    except (wave.Error, EOFError):
        raise HttpError(400, "bad_audio", "body must be a PCM WAV file")
    if channels != 1 or width != 2 or not ISOLATE_MIN_RATE <= rate <= ISOLATE_MAX_RATE:
        raise HttpError(
            400,
            "bad_audio",
            "audio must be mono 16-bit PCM between {} and {} Hz".format(
                ISOLATE_MIN_RATE, ISOLATE_MAX_RATE
            ),
        )
    pcm = array("h")
    pcm.frombytes(frames[: len(frames) - (len(frames) % 2)])
    if sys.byteorder == "big":
        pcm.byteswap()
    return pcm, rate


def validate_isolate(host: Host, query: str):
    params = parse_qs(query, keep_blank_values=True)
    unknown = sorted(set(params) - set(ISOLATE_PARAMS))
    if unknown:
        raise HttpError(400, "bad_request", "unknown parameter: {}".format(unknown[0]))
    values = params.get("model", [])
    if len(values) > 1:
        raise HttpError(400, "bad_request", "model given more than once")
    return validate_model(host, values[0] if values else None)


def fit_frames(samples, frames: int) -> list:
    """`samples` trimmed or zero-padded to exactly `frames` values, so the
    cleaned clip lines up with the one that was sent."""
    if hasattr(samples, "astype"):
        import numpy as np

        flat = np.asarray(samples, dtype=np.float32).reshape(-1)[:frames]
        return np.pad(flat, (0, frames - flat.shape[0]))
    out = [float(v) for v in samples[:frames]]
    if len(out) < frames:
        out.extend([0.0] * (frames - len(out)))
    return out


def validate_transcribe(host: Host, query: str, context_header) -> dict:
    """Everything but the audio: model, language, switches and context."""
    params = parse_qs(query, keep_blank_values=True)
    unknown = sorted(set(params) - set(TRANSCRIBE_PARAMS))
    if unknown:
        raise HttpError(400, "bad_request", "unknown parameter: {}".format(unknown[0]))
    for key, values in params.items():
        if len(values) != 1:
            raise HttpError(400, "bad_request", "{} given more than once".format(key))
    single = {key: values[0] for key, values in params.items()}
    info = validate_model(host, single.get("model"))
    language = single.get("language", "auto") or "auto"
    if language != "auto" and language not in LANGUAGES:
        raise HttpError(
            400,
            "unsupported_language",
            "language must be auto or one of {}".format(list(LANGUAGES)),
        )
    options = dict(TRANSCRIBE_DEFAULTS)
    for key in TRANSCRIBE_DEFAULTS:
        if key in single:
            options[key] = parse_flag(key, single[key])
    return {
        "info": info,
        "model": info.id,
        "language": None if language == "auto" else language,
        "context": validate_context(context_header),
        "options": options,
    }


# The webview is a different origin from a loopback port, so every authorised
# request is preceded by a CORS preflight. Answering it is what lets the window
# speak at all; the reply is limited to the origins Terax itself runs under, and
# the bearer token remains the thing that actually authorises a request.
ALLOWED_ORIGIN_EXACT = (
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
)
# The Vite dev server, whose port is assigned at run time.
ALLOWED_ORIGIN_PREFIX = ("http://localhost:", "http://127.0.0.1:")


def allowed_origin(origin):
    """The value to echo back, or None when the origin is not one of ours."""
    if not origin:
        return None
    if origin in ALLOWED_ORIGIN_EXACT:
        return origin
    if origin.startswith(ALLOWED_ORIGIN_PREFIX):
        return origin
    return None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "terax-tts"
    sys_version = ""

    @property
    def host(self) -> Host:
        return self.server.host

    def log_request(self, code="-", size="-"):
        status = code.value if hasattr(code, "value") else code
        log("{} {} {}".format(self.command or "-", (self.path or "-").split("?")[0], status))

    def log_message(self, fmt, *args):
        log(fmt % args)

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._send_cors_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_cors_headers(self) -> None:
        origin = allowed_origin(self.headers.get("Origin"))
        if origin is None:
            return
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")

    def do_OPTIONS(self):
        origin = allowed_origin(self.headers.get("Origin"))
        if origin is None:
            # No echo, no allowed methods: the browser refuses the real request.
            self.send_response(403)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "authorization, content-type, x-terax-context"
        )
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

    def _send_error_json(self, error: HttpError) -> None:
        # The request body may be unread (401, 413), so the connection cannot be reused.
        self.close_connection = True
        self._send_json(error.status, {"error": error.code, "message": error.message})

    def _authorize(self) -> None:
        header = self.headers.get("Authorization", "")
        prefix = "Bearer "
        token = header[len(prefix):] if header.startswith(prefix) else ""
        if not hmac.compare_digest(token.encode("utf-8"), self.server.token.encode("utf-8")):
            raise HttpError(401, "unauthorized", "missing or invalid token")

    def _read_body(self) -> dict:
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length) if raw_length else 0
        except ValueError:
            raise HttpError(400, "bad_request", "invalid Content-Length")
        if length < 0:
            raise HttpError(400, "bad_request", "invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise HttpError(413, "body_too_large", "body exceeds 64 KiB")
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise HttpError(400, "bad_request", "truncated body")
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise HttpError(400, "invalid_json", "body is not valid JSON")

    def _read_audio(self) -> bytes:
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length) if raw_length else 0
        except ValueError:
            raise HttpError(400, "bad_request", "invalid Content-Length")
        if length <= 0:
            raise HttpError(400, "empty_audio", "audio body is empty")
        if length > MAX_AUDIO_BYTES:
            raise HttpError(413, "body_too_large", "audio exceeds 20 MiB")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise HttpError(400, "bad_request", "truncated body")
        return raw

    def do_GET(self):
        self._dispatch(self._route_get)

    def do_POST(self):
        self._dispatch(self._route_post)

    def _dispatch(self, router) -> None:
        try:
            self._authorize()
            router(urlparse(self.path))
        except HttpError as error:
            self._send_error_json(error)
        except (Exception, SystemExit) as exc:
            # A dependency that calls sys.exit() must not drop the connection.
            log("unhandled: {}".format(exc))
            self._send_error_json(HttpError(500, "internal_error", "internal error"))

    def _route_get(self, url) -> None:
        if url.path == "/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "engine": self.host.engine_name,
                    "kind": self.host.kind,
                    "device": self.host.effective_device(),
                    "loadedModel": self.host.loaded_model,
                },
            )
            return
        if url.path == "/models":
            models = [
                {
                    "id": info.id,
                    "kind": self.host.kind,
                    "downloaded": is_downloaded(info),
                    "languages": list(info.languages),
                    "voiceSource": info.voice_source,
                    "builtinVoice": info.builtin_voice or None,
                    "sampleFreeVoices": {
                        language: sorted(sample_free_voices(info, language))
                        for language in info.languages
                    },
                }
                for info in self.host.engine.models()
            ]
            self._send_json(200, {"models": models})
            return
        if url.path == "/voices":
            requested = parse_qs(url.query).get("model", [""])[0]
            info = model_info(requested)
            if info is None or info.engine != self.host.engine_name:
                raise HttpError(400, "unknown_model", "unknown model")
            voices = [
                {"id": v.id, "label": v.label, "language": v.language}
                for v in self.host.engine.voices(info.id)
            ]
            self._send_json(200, {"voices": voices})
            return
        raise HttpError(404, "not_found", "no such route")

    def _route_post(self, url) -> None:
        if url.path == "/synthesize":
            require_kind(self.host, "speech")
            request = validate_synthesize(self.host, self._read_body())
            samples, sample_rate = self.host.synthesize(request)
            self._send(200, encode_wav(samples, sample_rate), "audio/wav")
            return
        if url.path == "/warmup":
            payload = self._read_body()
            info = validate_model(self.host, payload.get("model") if isinstance(payload, dict) else None)
            ensure_downloaded(info)
            self.host.warmup(info.id)
            reply = {"ok": True}
            if self.host.kind == "transcription":
                reply["selfTest"] = self.host.self_test(info.id)
            self._send_json(200, reply)
            return
        if url.path == "/transcribe":
            require_kind(self.host, "transcription")
            request = validate_transcribe(self.host, url.query, self.headers.get(CONTEXT_HEADER))
            pcm = decode_pcm_wav(self._read_audio())
            ensure_downloaded(request["info"])
            audio_ms = int(len(pcm) * 1000 / TRANSCRIPTION_SAMPLE_RATE)
            started = time.monotonic()
            if len(pcm) < MIN_TRANSCRIBE_FRAMES:
                result = {"text": "", "language": request["language"]}
            else:
                request["pcm"] = pcm
                result = self.host.transcribe(request)
            self._send_json(
                200,
                {
                    "text": (result.get("text") or "").strip(),
                    "language": result.get("language"),
                    "audioMs": audio_ms,
                    "elapsedMs": int((time.monotonic() - started) * 1000),
                },
            )
            return
        if url.path == "/isolate":
            require_kind(self.host, "cleanup")
            info = validate_isolate(self.host, url.query)
            pcm, rate = decode_mono_pcm_wav(self._read_audio())
            ensure_downloaded(info)
            if len(pcm) * 1000 < MIN_ISOLATE_MS * rate:
                cleaned = [v / 32768.0 for v in pcm]
            else:
                cleaned = fit_frames(self.host.isolate(info.id, pcm, rate), len(pcm))
            body = encode_wav(cleaned, rate) if len(cleaned) else _empty_wav(rate)
            self._send(200, body, "audio/wav")
            return
        if url.path == "/shutdown":
            self._read_body()
            self._send_json(200, {"ok": True})
            request_shutdown(self.server, "shutdown requested")
            return
        raise HttpError(404, "not_found", "no such route")


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, address, handler, host: Host, token: str) -> None:
        super().__init__(address, handler)
        self.host = host
        self.token = token


def request_shutdown(server: Server, reason: str) -> None:
    log(reason)
    threading.Thread(target=server.shutdown, daemon=True).start()


def watch_stdin(server: Server) -> None:
    """The parent owns our lifetime: EOF on stdin means Terax is gone."""
    stream = getattr(sys.stdin, "buffer", sys.stdin)
    try:
        while stream.read(1):
            pass
    except Exception:
        pass
    finally:
        request_shutdown(server, "stdin closed, exiting")


def read_token() -> str:
    token = os.environ.get("TERAX_TTS_TOKEN", "")
    if len(token) < MIN_TOKEN_CHARS:
        raise SystemExit("TERAX_TTS_TOKEN must be set and at least {} chars".format(MIN_TOKEN_CHARS))
    return token


def build_server(engine: str, device: str, samples_dir: str, token: str, host: str, port: int) -> Server:
    if host not in LOOPBACK_HOSTS:
        raise SystemExit("--host must be loopback, got {}".format(host))
    if not os.path.isdir(samples_dir):
        raise SystemExit("--samples-dir does not exist: {}".format(samples_dir))
    return Server((host, port), Handler, Host(engine, device, os.path.realpath(samples_dir)), token)


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Terax local TTS sidecar")
    parser.add_argument("--engine", required=True, choices=["kokoro", "chatterbox", "pocket", "omnivoice", "zonos3", "rumble", "isolator", "fake", "fake-stt", "fake-isolator"])
    parser.add_argument("--device", required=True, choices=["auto", "cpu", "mps", "cuda", "mlx"])
    parser.add_argument("--samples-dir", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    token = read_token()
    server = build_server(args.engine, args.device, args.samples_dir, token, args.host, args.port)
    port = server.server_address[1]
    threading.Thread(target=watch_stdin, args=(server,), daemon=True).start()
    sys.stdout.write(json.dumps({"ready": True, "port": port}) + "\n")
    sys.stdout.flush()
    sys.stdout = sys.stderr
    log("listening on {}:{} engine={} device={}".format(args.host, port, args.engine, args.device))
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        log("interrupted")
    finally:
        server.server_close()
        server.host.close()
    return 0


if __name__ == "__main__":
    exit_code = main()
    sys.stdout.flush()
    sys.stderr.flush()
    # The stdin watcher can be blocked in read(); a normal exit would abort on
    # interpreter finalisation, so leave without waiting for it.
    os._exit(exit_code)
