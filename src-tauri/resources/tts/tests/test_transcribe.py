"""Dictation contract tests: /transcribe, the warmup self-test and windowing.

Standard library only; the fake transcriber stands in for Rumble-2-Flash.
"""

from __future__ import annotations

import http.client
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import wave
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402
from engines import create_engine  # noqa: E402
from engines.base import (  # noqa: E402
    TRANSCRIPTION_LANGUAGES,
    join_pieces,
    model_info,
    split_windows,
)
from engines.rumble import language_tag, template_switches  # noqa: E402

TOKEN = "test-token-0123456789"
RATE = 16000


def wav_bytes(frames: bytes, rate: int = RATE, channels: int = 1, width: int = 2) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(width)
        handle.setframerate(rate)
        handle.writeframes(frames)
    return buffer.getvalue()


def tone(seconds: float, amplitude: int = 8000) -> bytes:
    count = int(seconds * RATE)
    return b"".join(
        int(amplitude if (i // 20) % 2 else -amplitude).to_bytes(2, "little", signed=True)
        for i in range(count)
    )


def silence(seconds: float) -> bytes:
    return bytes(2 * int(seconds * RATE))


class TranscribeCase(unittest.TestCase):
    engine = "fake-stt"

    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        samples = os.path.join(cls._tmp.name, "samples")
        os.makedirs(samples)
        cls.server = server.build_server(cls.engine, "cpu", samples, TOKEN, "127.0.0.1", 0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05})
        cls.thread.daemon = True
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        cls.server.server_close()
        cls.server.host.close()
        cls._tmp.cleanup()

    def request(self, method, path, body=None, headers=None, token=TOKEN):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            all_headers = dict(headers or {})
            if token is not None:
                all_headers["Authorization"] = "Bearer " + token
            connection.request(method, path, body=body, headers=all_headers)
            response = connection.getresponse()
            raw = response.read()
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else None
            except ValueError:
                payload = None
            return response.status, payload, dict(response.getheaders())
        finally:
            connection.close()

    def transcribe(self, frames: bytes, query: str = "model=fake-stt-model", headers=None):
        all_headers = {"Content-Type": "audio/wav"}
        all_headers.update(headers or {})
        return self.request("POST", "/transcribe?" + query, wav_bytes(frames), all_headers)

    @property
    def engine_calls(self) -> list:
        return self.server.host.engine.calls


class TranscribeContractTests(TranscribeCase):
    def test_health_and_models_report_the_kind(self):
        status, payload, _ = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload["kind"], "transcription")
        status, payload, _ = self.request("GET", "/models")
        self.assertEqual(status, 200)
        self.assertEqual([m["id"] for m in payload["models"]], ["fake-stt-model"])
        self.assertEqual(payload["models"][0]["kind"], "transcription")
        status, payload, _ = self.request("GET", "/voices?model=fake-stt-model")
        self.assertEqual((status, payload["voices"]), (200, []))

    def test_speech_is_transcribed_with_timings_and_defaults(self):
        status, payload, _ = self.transcribe(tone(1.5))
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["text"], "heard 24000 frames")
        self.assertEqual(payload["audioMs"], 1500)
        self.assertIsInstance(payload["elapsedMs"], int)
        call = self.engine_calls[-1]
        self.assertIsNone(call["language"])
        self.assertIsNone(call["context"])
        self.assertEqual(call["options"], {"filler": False, "verbatim": True, "digits": True})

    def test_language_switches_and_context_reach_the_engine(self):
        context = "Terax, Pi-Terax, Kokoro, señal"
        status, payload, _ = self.transcribe(
            tone(1.0),
            "model=fake-stt-model&language=es-ES&filler=1&verbatim=0&digits=false",
            {"X-Terax-Context": quote(context)},
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["language"], "es-ES")
        call = self.engine_calls[-1]
        self.assertEqual(call["language"], "es-ES")
        self.assertEqual(call["context"], context)
        self.assertEqual(call["options"], {"filler": True, "verbatim": False, "digits": False})

    def test_silence_gives_an_empty_string(self):
        status, payload, _ = self.transcribe(silence(2.0))
        self.assertEqual((status, payload["text"]), (200, ""))

    def test_a_clip_under_a_tenth_of_a_second_never_reaches_the_engine(self):
        before = len(self.engine_calls)
        status, payload, _ = self.transcribe(tone(0.05))
        self.assertEqual((status, payload["text"], payload["audioMs"]), (200, "", 50))
        self.assertEqual(len(self.engine_calls), before)

    def test_bad_requests_are_refused_with_their_codes(self):
        cases = [
            ("model=nope", {}, 400, "unknown_model"),
            ("model=rumble-2-flash", {}, 400, "wrong_engine"),
            ("model=fake-stt-model&language=ja-JP", {}, 400, "unsupported_language"),
            ("model=fake-stt-model&filler=maybe", {}, 400, "bad_request"),
            ("model=fake-stt-model&voice=x", {}, 400, "bad_request"),
            ("model=fake-stt-model&language=es-ES&language=en-US", {}, 400, "bad_request"),
            ("model=fake-stt-model", {"X-Terax-Context": quote("x" * 2001)}, 400, "context_too_long"),
            ("model=fake-stt-model", {"X-Terax-Context": "%ff%fe"}, 400, "bad_context"),
        ]
        for query, headers, status_code, code in cases:
            with self.subTest(query=query):
                status, payload, _ = self.transcribe(tone(0.5), query, headers)
                self.assertEqual((status, payload["error"]), (status_code, code))

    def test_audio_must_be_16k_mono_pcm16(self):
        cases = [
            wav_bytes(tone(0.5), rate=44100),
            wav_bytes(tone(0.5) * 2, channels=2),
            wav_bytes(bytes(RATE), width=1),
            b"not a wav file at all",
        ]
        for body in cases:
            status, payload, _ = self.request(
                "POST", "/transcribe?model=fake-stt-model", body, {"Content-Type": "audio/wav"}
            )
            self.assertEqual((status, payload["error"]), (400, "bad_audio"))
        status, payload, _ = self.request("POST", "/transcribe?model=fake-stt-model", b"")
        self.assertEqual((status, payload["error"]), (400, "empty_audio"))

    def test_an_oversized_body_is_refused_before_it_is_read(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            connection.putrequest("POST", "/transcribe?model=fake-stt-model")
            connection.putheader("Authorization", "Bearer " + TOKEN)
            connection.putheader("Content-Length", str(server.MAX_AUDIO_BYTES + 1))
            connection.endheaders()
            response = connection.getresponse()
            payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual((response.status, payload["error"]), (413, "body_too_large"))
        finally:
            connection.close()

    def test_a_transcription_engine_refuses_to_synthesize(self):
        status, payload, _ = self.request(
            "POST",
            "/synthesize",
            json.dumps({"model": "fake-stt-model", "text": "hola", "language": "es-ES"}).encode(),
            {"Content-Type": "application/json"},
        )
        self.assertEqual((status, payload["error"]), (409, "wrong_kind"))

    def test_warmup_runs_the_silence_self_test(self):
        status, payload, _ = self.request(
            "POST", "/warmup", json.dumps({"model": "fake-stt-model"}).encode(),
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 200, payload)
        self.assertTrue(payload["selfTest"]["ok"])
        self.assertIsInstance(payload["selfTest"]["elapsedMs"], int)
        self.assertEqual(self.engine_calls[-1]["frames"], RATE)

    def test_the_token_is_still_required(self):
        status, payload, _ = self.request(
            "POST", "/transcribe?model=fake-stt-model", wav_bytes(tone(0.5)), token="wrong-token-0123456789"
        )
        self.assertEqual((status, payload["error"]), (401, "unauthorized"))

    def test_the_preflight_allows_the_context_header(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            connection.request(
                "OPTIONS",
                "/transcribe",
                headers={"Origin": "tauri://localhost", "Access-Control-Request-Method": "POST"},
            )
            response = connection.getresponse()
            response.read()
            allowed = response.getheader("Access-Control-Allow-Headers").lower()
            self.assertIn("x-terax-context", allowed)
        finally:
            connection.close()


class SpeechEngineRefusesTranscriptionTests(TranscribeCase):
    engine = "fake"

    def test_a_speech_engine_refuses_to_transcribe(self):
        status, payload, _ = self.transcribe(tone(0.5), "model=fake-model")
        self.assertEqual((status, payload["error"]), (409, "wrong_kind"))

    def test_a_speech_warmup_has_no_self_test(self):
        status, payload, _ = self.request(
            "POST", "/warmup", json.dumps({"model": "fake-model"}).encode(),
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 200)
        self.assertNotIn("selfTest", payload)


class WindowTests(unittest.TestCase):
    def test_short_audio_is_one_window(self):
        self.assertEqual(split_windows([1] * (RATE * 10), RATE), [(0, RATE * 10)])
        self.assertEqual(split_windows([], RATE), [])

    def test_windows_cover_everything_and_never_exceed_thirty_seconds(self):
        samples = [1000] * (RATE * 70)
        ranges = split_windows(samples, RATE)
        self.assertEqual(ranges[0][0], 0)
        self.assertEqual(ranges[-1][1], len(samples))
        for (_, end), (start, _) in zip(ranges, ranges[1:]):
            self.assertEqual(end, start)
        for start, end in ranges:
            self.assertLessEqual(end - start, RATE * 30)

    def test_the_cut_lands_in_the_pause(self):
        samples = [3000] * (RATE * 40)
        pause_start = int(RATE * 27.0)
        pause_end = int(RATE * 27.4)
        for i in range(pause_start, pause_end):
            samples[i] = 0
        (_, cut), _ = split_windows(samples, RATE)
        self.assertTrue(pause_start <= cut <= pause_end, cut / RATE)

    def test_pieces_join_with_single_spaces(self):
        self.assertEqual(join_pieces([" Hola. ", "", "  ", "Adiós."]), "Hola. Adiós.")


class RumbleHelperTests(unittest.TestCase):
    def test_the_model_is_registered_for_transcription(self):
        info = model_info("rumble-2-flash")
        self.assertEqual((info.engine, info.repo, info.sample_rate), ("rumble", "Reson8/Rumble-2-Flash", RATE))
        self.assertIn("model.safetensors", info.required_files)
        engine = create_engine("rumble")
        self.assertEqual(engine.kind, "transcription")
        self.assertEqual([m.id for m in engine.models()], ["rumble-2-flash"])
        self.assertEqual(engine.voices("rumble-2-flash"), [])
        self.assertEqual(create_engine("kokoro").kind, "speech")

    def test_every_app_language_has_a_model_name(self):
        self.assertEqual(set(TRANSCRIPTION_LANGUAGES), set(server.LANGUAGES))
        self.assertEqual(language_tag("Spanish"), "es-ES")
        self.assertEqual(language_tag("Japanese"), "Japanese")
        self.assertIsNone(language_tag(None))

    def test_template_switches_keep_the_model_card_defaults(self):
        self.assertEqual(template_switches({}), {"filler": False, "verbatim": True, "digits": True})
        self.assertEqual(
            template_switches({"filler": True, "verbatim": False, "digits": False}),
            {"filler": True, "verbatim": False, "digits": False},
        )

    def test_transcribing_before_loading_fails_cleanly(self):
        with self.assertRaises(RuntimeError):
            create_engine("rumble").transcribe("rumble-2-flash", [0] * RATE, None, None, {})


if __name__ == "__main__":
    unittest.main()
