import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { usePreferencesStore } from "@/modules/settings/preferences";
import { dictationStatusCommand, dictationTranscribeCommand } from "./commands";

function engine(overrides: Record<string, unknown> = {}) {
  return {
    id: "rumble",
    installed: true,
    specVersion: 1,
    installedAt: 1,
    latestSpecVersion: 1,
    running: true,
    port: 51_000,
    token: "t0ken",
    device: "auto",
    pid: 42,
    sizeBytes: 10,
    ...overrides,
  };
}

function status(entry = engine(), downloaded = true) {
  return {
    runtime: { installed: true, uvVersion: null, pythonVersion: null },
    engines: [],
    models: [],
    jobs: [
      { id: 1, kind: "engine-install", engine: "rumble", model: null },
      { id: 2, kind: "engine-install", engine: "kokoro", model: null },
    ],
    diskUsageBytes: 0,
    transcribers: [entry],
    transcriberModels: [
      { id: "rumble-2-flash", engine: "rumble", downloaded, sizeBytes: 1 },
    ],
  };
}

class FakeOfflineContext {
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  async decodeAudioData(_bytes: ArrayBuffer) {
    const left = new Float32Array(16_000).fill(0.5);
    const right = new Float32Array(16_000).fill(-0.5);
    return {
      numberOfChannels: 2,
      length: 16_000,
      getChannelData: (c: number) => (c === 0 ? left : right),
    };
  }
}

describe("dictation commands", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.stubGlobal("OfflineAudioContext", FakeOfflineContext);
    usePreferencesStore.setState({
      sttProvider: "local",
      sttLocalModel: "rumble-2-flash",
      sttLanguage: "auto",
      sttMode: "prompt",
      sttDictionary: [{ written: "Pi-Terax", spoken: "piterax" }],
      sttLiveSegments: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the dictation engine without its token and only its jobs", async () => {
    invoke.mockResolvedValueOnce(status());
    const report = await dictationStatusCommand();
    expect(report.engines[0]).not.toHaveProperty("token");
    expect(report.engines[0].ready).toBe(false);
    expect(report.jobs.map((job) => job.id)).toEqual([1]);
    expect(report.dictionaryTerms).toBe(1);
    expect(report.tiers.map((tier) => tier.state)).toEqual([
      "available",
      "planned",
      "planned",
    ]);
  });

  it("refuses to transcribe while the engine is stopped", async () => {
    invoke.mockResolvedValueOnce(status(engine({ running: false, port: null, token: null })));
    await expect(dictationTranscribeCommand({ path: "/tmp/a.wav" })).rejects.toMatchObject({
      code: "command_failed",
      message: expect.stringContaining("dictation.start"),
    });
  });

  it("decodes the file to mono 16 kHz, transcribes it and tidies the text", async () => {
    invoke
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(new ArrayBuffer(8));
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit = {}) =>
        new Response(
          JSON.stringify({ text: "abre piterax", language: "es-ES", audioMs: 1000, elapsedMs: 30 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const report = await dictationTranscribeCommand({
      path: "/tmp/a.wav",
      spokenLanguage: "es-ES",
      writingStyle: "formal",
    });

    expect(invoke).toHaveBeenNthCalledWith(2, "stt_read_audio_file", { path: "/tmp/a.wav" });
    const [url, init = {}] = fetchMock.mock.calls[0];
    expect(url).toContain("language=es-ES");
    expect((init.headers as Record<string, string>)["X-Terax-Context"]).toBe("Pi-Terax");
    // 1 s of stereo that cancels out: a 44-byte header plus 16000 silent samples.
    expect((init.body as Blob).size).toBe(44 + 32_000);
    expect(report.raw).toBe("abre piterax");
    expect(report.text).toBe("Abre Pi-Terax.");
    expect(report.mode).toBe("formal");
  });

  it("waits for a model that is still loading", async () => {
    invoke.mockResolvedValueOnce(status()).mockResolvedValueOnce(new ArrayBuffer(8));
    const loading = () =>
      new Response(JSON.stringify({ error: "loading", message: "a model is loading" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    const ok = new Response(
      JSON.stringify({ text: "hola", language: "es-ES", audioMs: 1000, elapsedMs: 30 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
    const responses = [loading(), loading(), ok];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => responses.shift() as Response),
    );
    const report = await dictationTranscribeCommand({ path: "/tmp/a.wav" });
    expect(report.raw).toBe("hola");
    expect(responses).toHaveLength(0);
  });

  it("reports a refused request as a plain command failure", async () => {
    invoke.mockResolvedValueOnce(status()).mockResolvedValueOnce(new ArrayBuffer(8));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "bad_audio", message: "not a wav" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(dictationTranscribeCommand({ path: "/tmp/a.wav" })).rejects.toMatchObject({
      code: "command_failed",
    });
  });
});
