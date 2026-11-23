"""Cleanup contract tests: /isolate and the isolator catalogue.

Standard library only; the fake isolator halves the signal in place of the
Inworld model, so a test can tell the cleaned clip from the one it sent.
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
from array import array

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import download  # noqa: E402
import server  # noqa: E402
from engines import base  # noqa: E402

TOKEN = "test-token-0123456789"


def wav_bytes(samples, rate: int = 16000, channels: int = 1, width: int = 2) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(width)
        handle.setframerate(rate)
        handle.writeframes(
            b"".join(int(v).to_bytes(width, "little", signed=True) for v in samples)
        )
    return buffer.getvalue()


def read_wav(raw: bytes) -> tuple:
    with wave.open(io.BytesIO(raw), "rb") as reader:
        rate = reader.getframerate()
        frames = reader.readframes(reader.getnframes())
        channels = reader.getnchannels()
    pcm = array("h")
    pcm.frombytes(frames)
    if sys.byteorder == "big":
        pcm.byteswap()
    return list(pcm), rate, channels


class IsolateCase(unittest.TestCase):
    engine = "fake-isolator"

    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        samples = os.path.join(cls._tmp.name, "samples")
        os.makedirs(samples)
        cls.server = server.build_server(cls.engine, "cpu", samples, TOKEN, "127.0.0.1", 0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}
        )
        cls.thread.daemon = True
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        cls.server.server_close()
        cls.server.host.close()
        cls._tmp.cleanup()

    def post(self, path, body: bytes, token=TOKEN):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            headers = {"Content-Type": "audio/wav"}
            if token is not None:
                headers["Authorization"] = "Bearer " + token
            connection.request("POST", path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, response.getheader("Content-Type"), response.read()
        finally:
            connection.close()

    def error_of(self, raw: bytes) -> str:
        return json.loads(raw.decode("utf-8"))["error"]


class IsolateRouteTests(IsolateCase):
    def test_returns_the_cleaned_clip_at_the_rate_and_length_it_was_sent(self):
        for rate in (16000, 24000, 44100, 48000):
            sent = [((i * 37) % 2000) - 1000 for i in range(rate // 10)]
            status, kind, raw = self.post(
                "/isolate?model=fake-isolator-model", wav_bytes(sent, rate=rate)
            )
            self.assertEqual(status, 200, raw)
            self.assertEqual(kind, "audio/wav")
            got, got_rate, channels = read_wav(raw)
            self.assertEqual(got_rate, rate)
            self.assertEqual(channels, 1)
            self.assertEqual(len(got), len(sent))
            for before, after in zip(sent[:50], got[:50]):
                self.assertLessEqual(abs(after - before / 2), 1)

    def test_a_clip_too_short_to_clean_comes_back_untouched(self):
        sent = [1000, -1000, 500]
        calls = len(self.server.host.engine.calls)
        status, _, raw = self.post("/isolate?model=fake-isolator-model", wav_bytes(sent))
        self.assertEqual(status, 200)
        got, _, _ = read_wav(raw)
        self.assertEqual(len(got), 3)
        self.assertLessEqual(abs(got[0] - 1000), 1)
        self.assertEqual(len(self.server.host.engine.calls), calls)

    def test_an_empty_clip_is_an_empty_wav(self):
        status, _, raw = self.post("/isolate?model=fake-isolator-model", wav_bytes([]))
        self.assertEqual(status, 200)
        got, rate, _ = read_wav(raw)
        self.assertEqual(got, [])
        self.assertEqual(rate, 16000)

    def test_requires_the_token(self):
        status, _, _ = self.post(
            "/isolate?model=fake-isolator-model", wav_bytes([0] * 400), token=None
        )
        self.assertEqual(status, 401)

    def test_refuses_stereo_wide_samples_and_rates_out_of_range(self):
        for body in (
            wav_bytes([0] * 400, channels=2),
            wav_bytes([0] * 400, width=4),
            wav_bytes([0] * 400, rate=96000),
            wav_bytes([0] * 400, rate=4000),
            b"not a wav",
        ):
            status, _, raw = self.post("/isolate?model=fake-isolator-model", body)
            self.assertEqual(status, 400)
            self.assertEqual(self.error_of(raw), "bad_audio")

    def test_refuses_unknown_models_and_parameters(self):
        status, _, raw = self.post("/isolate?model=nope", wav_bytes([0] * 400))
        self.assertEqual((status, self.error_of(raw)), (400, "unknown_model"))
        status, _, raw = self.post("/isolate", wav_bytes([0] * 400))
        self.assertEqual((status, self.error_of(raw)), (400, "unknown_model"))
        status, _, raw = self.post(
            "/isolate?model=fake-isolator-model&gain=2", wav_bytes([0] * 400)
        )
        self.assertEqual((status, self.error_of(raw)), (400, "bad_request"))
        status, _, raw = self.post(
            "/isolate?model=fake-isolator-model&model=fake-isolator-model",
            wav_bytes([0] * 400),
        )
        self.assertEqual((status, self.error_of(raw)), (400, "bad_request"))

    def test_refuses_a_model_of_another_engine(self):
        status, _, raw = self.post("/isolate?model=voice-isolator-v1", wav_bytes([0] * 400))
        self.assertEqual((status, self.error_of(raw)), (400, "wrong_engine"))

    def test_the_cleanup_engine_neither_speaks_nor_transcribes(self):
        status, _, raw = self.post("/transcribe?model=fake-isolator-model", wav_bytes([0] * 400))
        self.assertEqual((status, self.error_of(raw)), (409, "wrong_kind"))
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            body = json.dumps(
                {"model": "fake-isolator-model", "text": "hola", "language": "es-ES"}
            ).encode("utf-8")
            connection.request(
                "POST",
                "/synthesize",
                body=body,
                headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
            )
            response = connection.getresponse()
            self.assertEqual(response.status, 409)
        finally:
            connection.close()


class TranscriberRefusesIsolateTests(unittest.TestCase):
    def test_a_transcription_engine_does_not_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            samples = os.path.join(tmp, "samples")
            os.makedirs(samples)
            srv = server.build_server("fake-stt", "cpu", samples, TOKEN, "127.0.0.1", 0)
            thread = threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05})
            thread.daemon = True
            thread.start()
            try:
                connection = http.client.HTTPConnection(
                    "127.0.0.1", srv.server_address[1], timeout=20
                )
                connection.request(
                    "POST",
                    "/isolate?model=fake-stt-model",
                    body=wav_bytes([0] * 400),
                    headers={"Authorization": "Bearer " + TOKEN},
                )
                self.assertEqual(connection.getresponse().status, 409)
                connection.close()
            finally:
                srv.shutdown()
                thread.join(timeout=5)
                srv.server_close()
                srv.host.close()


class IsolatorCatalogueTests(unittest.TestCase):
    def test_the_model_is_the_pinned_offline_checkpoint(self):
        info = base.model_info("voice-isolator-v1")
        self.assertEqual(info.engine, "isolator")
        self.assertEqual(info.repo, "inworld/voice-isolator")
        self.assertEqual(info.required_files, ("denoiser.safetensors",))
        self.assertEqual(download.REVISIONS["voice-isolator-v1"], base.ISOLATOR_REVISION)
        self.assertIn("denoiser.safetensors", download.ALLOW_PATTERNS["voice-isolator-v1"])
        self.assertNotIn(
            "denoiser_realtime.safetensors", download.ALLOW_PATTERNS["voice-isolator-v1"]
        )

    def test_weights_path_follows_the_hub_cache_and_the_pinned_revision(self):
        with tempfile.TemporaryDirectory() as root:
            previous = os.environ.get("HF_HUB_CACHE")
            os.environ["HF_HUB_CACHE"] = root
            try:
                info = base.model_info("voice-isolator-v1")
                self.assertFalse(base.is_downloaded(info))
                path = base.isolator_weights_path()
                self.assertEqual(
                    path,
                    os.path.join(
                        root,
                        "models--inworld--voice-isolator",
                        "snapshots",
                        base.ISOLATOR_REVISION,
                        "denoiser.safetensors",
                    ),
                )
                os.makedirs(os.path.dirname(path))
                with open(path, "wb") as handle:
                    handle.write(b"0")
                self.assertTrue(base.is_downloaded(info))
            finally:
                if previous is None:
                    del os.environ["HF_HUB_CACHE"]
                else:
                    os.environ["HF_HUB_CACHE"] = previous


class FitFramesTests(unittest.TestCase):
    def test_trims_and_pads_lists(self):
        self.assertEqual(server.fit_frames([0.1, 0.2, 0.3], 2), [0.1, 0.2])
        self.assertEqual(server.fit_frames([0.1], 3), [0.1, 0.0, 0.0])


if __name__ == "__main__":
    unittest.main()
