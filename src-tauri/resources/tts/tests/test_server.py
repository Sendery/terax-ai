"""Sidecar HTTP contract tests. Standard library only, no weights loaded."""

from __future__ import annotations

import http.client
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import wave

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402
from engines.base import split_sentences  # noqa: E402

TOKEN = "test-token-0123456789"
TTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_PATH = os.path.join(TTS_DIR, "server.py")


class ServerCase(unittest.TestCase):
    """Runs one in-process sidecar per class on the loopback interface."""

    engine = "fake"

    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        cls.samples_dir = os.path.join(cls._tmp.name, "samples")
        os.makedirs(cls.samples_dir)
        cls.sample = os.path.join(cls.samples_dir, "voice.wav")
        with open(cls.sample, "wb") as handle:
            handle.write(b"RIFF")
        cls.outside = os.path.join(cls._tmp.name, "outside.wav")
        with open(cls.outside, "wb") as handle:
            handle.write(b"RIFF")
        cls.server = server.build_server(cls.engine, "cpu", cls.samples_dir, TOKEN, "127.0.0.1", 0)
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

    def request(self, method, path, body=None, token=TOKEN, raw_body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            headers = {}
            if token is not None:
                headers["Authorization"] = "Bearer " + token
            payload = raw_body
            if body is not None:
                payload = json.dumps(body).encode("utf-8")
            if payload is not None:
                headers["Content-Type"] = "application/json"
            connection.request(method, path, body=payload, headers=headers)
            response = connection.getresponse()
            return response.status, response.getheader("Content-Type"), response.read()
        finally:
            connection.close()

    def get_json(self, path, token=TOKEN):
        status, _, raw = self.request("GET", path, token=token)
        return status, json.loads(raw.decode("utf-8"))

    def post_json(self, path, body, token=TOKEN):
        return self.request("POST", path, body=body, token=token)

    def error_code(self, path, body):
        status, _, raw = self.post_json(path, body)
        return status, json.loads(raw.decode("utf-8"))["error"]

    def synth_body(self, **overrides):
        raise NotImplementedError


class FakeEngineTests(ServerCase):
    engine = "fake"

    def synth_body(self, **overrides):
        body = {"model": "fake-model", "text": "hola mundo", "language": "es-ES"}
        body.update(overrides)
        return body

    def test_requires_token(self):
        status, payload = self.get_json("/health", token=None)
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "unauthorized")

    def test_rejects_wrong_token(self):
        status, payload = self.get_json("/health", token="wrong-token-000000000")
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "unauthorized")

    def test_rejects_token_prefix(self):
        status, _ = self.get_json("/health", token=TOKEN[:-1])
        self.assertEqual(status, 401)

    def test_health(self):
        status, payload = self.get_json("/health")
        self.assertEqual(status, 200)
        self.assertIs(payload["ok"], True)
        self.assertEqual(payload["engine"], "fake")
        self.assertEqual(payload["device"], "cpu")
        self.assertIn("loadedModel", payload)

    def test_models(self):
        status, payload = self.get_json("/models")
        self.assertEqual(status, 200)
        models = payload["models"]
        self.assertEqual([m["id"] for m in models], ["fake-model"])
        self.assertIs(models[0]["downloaded"], True)
        self.assertEqual(sorted(models[0]["languages"]), ["en-US", "es-ES"])
        self.assertEqual(models[0]["voiceSource"], "preset")

    def test_voices(self):
        status, payload = self.get_json("/voices?model=fake-model")
        self.assertEqual(status, 200)
        self.assertEqual([v["id"] for v in payload["voices"]], ["fake_a", "fake_b"])
        self.assertEqual({v["language"] for v in payload["voices"]}, {"en-US", "es-ES"})

    def test_voices_rejects_other_engine_model(self):
        status, payload = self.get_json("/voices?model=kokoro-82m")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "unknown_model")

    def test_unknown_route(self):
        status, payload = self.get_json("/nope")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"], "not_found")

    def test_synthesize_returns_wav(self):
        status, content_type, raw = self.post_json("/synthesize", self.synth_body(voice="fake_b"))
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "audio/wav")
        with wave.open(io.BytesIO(raw), "rb") as handle:
            self.assertEqual(handle.getnchannels(), 1)
            self.assertEqual(handle.getsampwidth(), 2)
            self.assertEqual(handle.getframerate(), 24000)
            self.assertGreater(handle.getnframes(), 0)

    def test_synthesize_accepts_sample_inside_dir(self):
        status, _, _ = self.post_json("/synthesize", self.synth_body(samplePath=self.sample))
        self.assertEqual(status, 200)

    def test_synthesize_reports_loaded_model(self):
        self.post_json("/synthesize", self.synth_body())
        status, payload = self.get_json("/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload["loadedModel"], "fake-model")

    def test_warmup(self):
        status, _, raw = self.post_json("/warmup", {"model": "fake-model"})
        self.assertEqual(status, 200)
        self.assertIs(json.loads(raw.decode("utf-8"))["ok"], True)

    def test_rejects_unknown_model(self):
        self.assertEqual(self.error_code("/synthesize", self.synth_body(model="nope")), (400, "unknown_model"))

    def test_rejects_other_engine_model(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(model="kokoro-82m")),
            (400, "wrong_engine"),
        )

    def test_rejects_empty_text(self):
        self.assertEqual(self.error_code("/synthesize", self.synth_body(text="   \n\t ")), (400, "empty_text"))

    def test_rejects_missing_text(self):
        body = self.synth_body()
        del body["text"]
        self.assertEqual(self.error_code("/synthesize", body), (400, "empty_text"))

    def test_rejects_oversize_text(self):
        body = self.synth_body(text="a " * (server.MAX_TEXT_CHARS // 2 + 8))
        self.assertEqual(self.error_code("/synthesize", body), (400, "text_too_long"))

    def test_rejects_unknown_language(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(language="fr-FR")),
            (400, "unsupported_language"),
        )

    def test_rejects_unknown_param(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(params={"pitch": 1.0})),
            (400, "unknown_param"),
        )

    def test_rejects_param_of_other_engine(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(params={"cfgWeight": 0.5})),
            (400, "unknown_param"),
        )

    def test_rejects_out_of_range_param(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(params={"speed": 9.0})),
            (400, "param_out_of_range"),
        )

    def test_rejects_non_numeric_param(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(params={"speed": "fast"})),
            (400, "param_out_of_range"),
        )

    def test_accepts_in_range_param(self):
        status, _, _ = self.post_json("/synthesize", self.synth_body(params={"speed": 1.5}))
        self.assertEqual(status, 200)

    def test_rejects_unknown_field(self):
        self.assertEqual(self.error_code("/synthesize", self.synth_body(nope=1)), (400, "bad_request"))

    def test_rejects_sample_outside_dir(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(samplePath=self.outside)),
            (400, "invalid_sample_path"),
        )

    def test_rejects_sample_traversal(self):
        traversal = os.path.join(self.samples_dir, "..", "outside.wav")
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(samplePath=traversal)),
            (400, "invalid_sample_path"),
        )

    def test_rejects_missing_sample(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(samplePath=os.path.join(self.samples_dir, "gone.wav"))),
            (400, "invalid_sample_path"),
        )

    def test_rejects_invalid_json(self):
        status, _, raw = self.request("POST", "/synthesize", raw_body=b"{not json")
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw.decode("utf-8"))["error"], "invalid_json")

    def test_rejects_oversize_body(self):
        status, _, raw = self.request(
            "POST", "/synthesize", raw_body=b"x" * (server.MAX_BODY_BYTES + 64)
        )
        self.assertEqual(status, 413)
        self.assertEqual(json.loads(raw.decode("utf-8"))["error"], "body_too_large")


class ChatterboxContractTests(ServerCase):
    """Validation only; the clone engine never imports torch in these tests."""

    engine = "chatterbox"

    def synth_body(self, **overrides):
        body = {"model": "chatterbox-turbo", "text": "hello world", "language": "en-US"}
        body.update(overrides)
        return body

    def test_health_reports_engine(self):
        status, payload = self.get_json("/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload["engine"], "chatterbox")
        self.assertIsNone(payload["loadedModel"])

    def test_models(self):
        status, payload = self.get_json("/models")
        self.assertEqual(status, 200)
        self.assertEqual(
            sorted(m["id"] for m in payload["models"]),
            ["chatterbox-multilingual", "chatterbox-nano", "chatterbox-turbo"],
        )
        self.assertEqual({m["voiceSource"] for m in payload["models"]}, {"clone"})
        self.assertEqual({m["builtinVoice"] for m in payload["models"]}, {"builtin"})

    def test_voices_are_the_built_in_one(self):
        status, payload = self.get_json("/voices?model=chatterbox-turbo")
        self.assertEqual(status, 200)
        # One voice, and no language: the speaker in the weights is used for
        # every language the model supports.
        self.assertEqual([v["id"] for v in payload["voices"]], ["builtin"])
        self.assertEqual(payload["voices"][0]["language"], "other")

    def test_turbo_refuses_spanish(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(language="es-ES")),
            (400, "unsupported_language_for_model"),
        )

    def test_nano_refuses_spanish(self):
        body = self.synth_body(model="chatterbox-nano", language="es-ES")
        self.assertEqual(self.error_code("/synthesize", body), (400, "unsupported_language_for_model"))

    def test_requires_sample(self):
        self.assertEqual(self.error_code("/synthesize", self.synth_body()), (400, "sample_required"))

    def test_accepts_chatterbox_params(self):
        body = self.synth_body(params={"exaggeration": 0.5, "cfgWeight": 0.5, "temperature": 0.8})
        self.assertEqual(self.error_code("/synthesize", body), (400, "sample_required"))

    def test_rejects_kokoro_param(self):
        self.assertEqual(
            self.error_code("/synthesize", self.synth_body(params={"speed": 1.0})),
            (400, "unknown_param"),
        )


class LifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.env = {
            "PATH": os.environ.get("PATH", ""),
            "TERAX_TTS_TOKEN": TOKEN,
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
        }

    def spawn(self, env=None):
        process = subprocess.Popen(
            [sys.executable, "-u", SERVER_PATH, "--engine", "fake", "--device", "cpu", "--samples-dir", self._tmp.name],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=self.env if env is None else env,
            text=True,
        )
        self.addCleanup(self._kill, process)
        return process

    def _kill(self, process):
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None and not stream.closed:
                stream.close()

    def ready_port(self, process) -> int:
        payload = json.loads(process.stdout.readline())
        self.assertEqual(set(payload), {"ready", "port"})
        self.assertIs(payload["ready"], True)
        self.assertIsInstance(payload["port"], int)
        self.assertGreater(payload["port"], 0)
        return payload["port"]

    def test_ready_line_and_shutdown(self):
        process = self.spawn()
        port = self.ready_port(process)
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
        try:
            connection.request("POST", "/shutdown", headers={"Authorization": "Bearer " + TOKEN})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIs(json.loads(response.read().decode("utf-8"))["ok"], True)
        finally:
            connection.close()
        self.assertEqual(process.wait(timeout=15), 0)

    def test_exits_when_stdin_closes(self):
        process = self.spawn()
        self.ready_port(process)
        process.stdin.close()
        self.assertEqual(process.wait(timeout=15), 0)

    def test_refuses_short_token(self):
        env = dict(self.env, TERAX_TTS_TOKEN="short")
        self.assertNotEqual(self.spawn(env=env).wait(timeout=15), 0)

    def test_refuses_missing_token(self):
        env = dict(self.env)
        del env["TERAX_TTS_TOKEN"]
        self.assertNotEqual(self.spawn(env=env).wait(timeout=15), 0)


class BuiltinVoiceValidationTests(unittest.TestCase):
    """A clone model owns one voice; that one alone needs nothing to clone."""

    class _Host:
        engine_name = "chatterbox"

        def __init__(self, samples_dir):
            self.samples_dir = samples_dir

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.samples_dir = os.path.join(self._tmp.name, "samples")
        os.makedirs(self.samples_dir)
        self.sample = os.path.join(self.samples_dir, "voice.wav")
        with open(self.sample, "wb") as handle:
            handle.write(b"RIFF")
        self.host = self._Host(self.samples_dir)
        self._downloaded = server.is_downloaded
        server.is_downloaded = lambda info: True
        self.addCleanup(setattr, server, "is_downloaded", self._downloaded)

    def body(self, **over):
        payload = {
            "model": "chatterbox-multilingual",
            "text": "Hola",
            "language": "es-ES",
            "voice": "builtin",
        }
        payload.update(over)
        return payload

    def test_builtin_voice_is_accepted_without_a_sample(self):
        request = server.validate_synthesize(self.host, self.body())
        self.assertIsNone(request["samplePath"])
        self.assertEqual(request["voice"], "builtin")

    def test_any_other_voice_still_needs_a_sample(self):
        with self.assertRaises(server.HttpError) as caught:
            server.validate_synthesize(self.host, self.body(voice="someone"))
        self.assertEqual(caught.exception.code, "sample_required")

    def test_a_sample_is_still_accepted_alongside_the_builtin_id(self):
        request = server.validate_synthesize(
            self.host, self.body(samplePath=self.sample)
        )
        self.assertEqual(request["samplePath"], os.path.realpath(self.sample))


class SplitSentencesTests(unittest.TestCase):
    def test_collapses_and_packs(self):
        self.assertEqual(split_sentences("Uno.  Dos.\n\tTres.", 200), ["Uno. Dos. Tres."])

    def test_splits_on_limit(self):
        self.assertEqual(split_sentences("Uno. Dos. Tres.", 9), ["Uno. Dos.", "Tres."])

    def test_hard_splits_long_sentence(self):
        chunks = split_sentences("a" * 30 + " " + "b" * 30, 32)
        self.assertTrue(all(len(c) <= 32 for c in chunks))
        self.assertEqual("".join(chunks), "a" * 30 + "b" * 30)

    def test_empty(self):
        self.assertEqual(split_sentences("   ", 100), [])


if __name__ == "__main__":
    unittest.main()
