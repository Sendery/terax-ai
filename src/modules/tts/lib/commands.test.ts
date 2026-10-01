import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsStatus } from "./native";
import type { VoiceProfile } from "./voices";

const nativeMock = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  installEngine: vi.fn(),
  downloadModel: vi.fn(),
}));

const speakerMock = vi.hoisted(() => ({
  speakText: vi.fn(),
  stopSpeaking: vi.fn(() => true),
}));

const voiceMock = vi.hoisted(() => ({
  resolveActiveVoice: vi.fn(),
  listVoices: vi.fn(),
}));

vi.mock("@/modules/tts/lib/native", () => ({
  ttsNative: nativeMock,
  runningEnginesOf: (status: TtsStatus | null) =>
    (status?.engines ?? []).filter((e) => e.running).map((e) => e.id),
}));

vi.mock("@/modules/tts/lib/useSpeaker", () => speakerMock);

vi.mock("@/modules/tts/lib/activeVoice", () => voiceMock);

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ ttsDevice: "cpu" }) },
}));

import {
  ttsDownloadCommand,
  ttsInstallCommand,
  ttsSpeakCommand,
  ttsStartCommand,
  ttsStatusCommand,
  ttsStopCommand,
  ttsStopSpeakingCommand,
  ttsVoicesCommand,
} from "./commands";
import { useTtsStore } from "../store/ttsStore";

function status(overrides: Partial<TtsStatus> = {}): TtsStatus {
  return {
    runtime: { installed: true, uvVersion: "0.12.9", pythonVersion: "3.11.9" },
    engines: [
      {
        id: "kokoro",
        installed: true,
        specVersion: 1,
        installedAt: 10,
        latestSpecVersion: 1,
        running: true,
        port: 51234,
        token: "leaked-token",
        device: "cpu",
        pid: 4242,
        sizeBytes: 700,
      },
      {
        id: "chatterbox",
        installed: false,
        specVersion: null,
        installedAt: null,
        latestSpecVersion: 1,
        running: false,
        port: null,
        token: null,
        device: null,
        pid: null,
        sizeBytes: 0,
      },
    ],
    models: [
      { id: "kokoro-82m", engine: "kokoro", downloaded: true, sizeBytes: 330 },
    ],
    jobs: [],
    diskUsageBytes: 1030,
    ...overrides,
  };
}

const voice: VoiceProfile = {
  id: "v-es",
  name: "Dora",
  model: "kokoro-82m",
  language: "es-ES",
  voice: "ef_dora",
  sampleId: null,
  params: {},
  style: {},
  createdAt: 0,
};

describe("tts registry handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speakerMock.stopSpeaking.mockReturnValue(true);
    useTtsStore.setState({
      speaking: false,
      currentVoice: null,
      progress: { index: 0, total: 0 },
      error: null,
      runningEngines: [],
      status: null,
    });
  });

  it("reports status without the sidecar token and caches it for the snapshot", async () => {
    nativeMock.status.mockResolvedValue(status());
    useTtsStore.setState({
      speaking: true,
      currentVoice: voice,
      progress: { index: 1, total: 3 },
    });

    const report = await ttsStatusCommand();

    expect(JSON.stringify(report)).not.toContain("leaked-token");
    expect(report.engines.map((e) => e.id)).toEqual(["kokoro", "chatterbox"]);
    expect(report.engines[0]).not.toHaveProperty("token");
    expect(report.speech).toEqual({
      speaking: true,
      voiceId: "v-es",
      progress: { index: 1, total: 3 },
      error: null,
    });
    expect(useTtsStore.getState().status).not.toBeNull();
    expect(useTtsStore.getState().runningEngines).toEqual(["kokoro"]);
  });

  it("starts an engine without waiting for the sidecar to come up", async () => {
    let resolveStart: (value: { port: number; token: string }) => void =
      () => {};
    nativeMock.start.mockReturnValue(
      new Promise<{ port: number; token: string }>((resolve) => {
        resolveStart = resolve;
      }),
    );

    expect(ttsStartCommand("kokoro")).toEqual({
      engine: "kokoro",
      starting: true,
    });
    expect(nativeMock.start).toHaveBeenCalledWith("kokoro", "cpu");

    resolveStart({ port: 1, token: "t" });
    await Promise.resolve();
    await Promise.resolve();
    expect(useTtsStore.getState().runningEngines).toEqual(["kokoro"]);
  });

  it("routes a failed start into the store error instead of throwing", async () => {
    nativeMock.start.mockRejectedValue(new Error("no runtime"));

    ttsStartCommand("kokoro");
    await Promise.resolve();
    await Promise.resolve();

    expect(useTtsStore.getState().error).toBe("no runtime");
  });

  it("stops only the running engines, and only the named one when given", async () => {
    nativeMock.status.mockResolvedValue(status());
    nativeMock.stop.mockResolvedValue(undefined);

    await expect(ttsStopCommand()).resolves.toEqual({ stopped: ["kokoro"] });
    expect(nativeMock.stop).toHaveBeenCalledExactlyOnceWith("kokoro");
    expect(useTtsStore.getState().runningEngines).toEqual([]);

    vi.clearAllMocks();
    nativeMock.status.mockResolvedValue(status());
    await expect(ttsStopCommand("chatterbox")).resolves.toEqual({
      stopped: [],
    });
    expect(nativeMock.stop).not.toHaveBeenCalled();
  });

  it("silences playback when the engine that is speaking goes down", async () => {
    nativeMock.status.mockResolvedValue(status());
    nativeMock.stop.mockResolvedValue(undefined);
    useTtsStore.setState({ speaking: true, currentVoice: voice });

    await ttsStopCommand("kokoro");

    expect(speakerMock.stopSpeaking).toHaveBeenCalledTimes(1);
  });

  it("returns the job id for an install and a download", async () => {
    nativeMock.installEngine.mockResolvedValue(7);
    nativeMock.downloadModel.mockResolvedValue(8);

    await expect(ttsInstallCommand("kokoro")).resolves.toEqual({ jobId: 7 });
    await expect(ttsDownloadCommand("kokoro-82m")).resolves.toEqual({
      jobId: 8,
    });
  });

  it("lists voices through the store-bound resolver", async () => {
    voiceMock.listVoices.mockResolvedValue([{ id: "v-es" }]);

    await expect(ttsVoicesCommand()).resolves.toEqual({
      voices: [{ id: "v-es" }],
    });
  });

  it("resolves the voice before speaking and reports the computed chunk count", async () => {
    voiceMock.resolveActiveVoice.mockResolvedValue(voice);
    // Never awaited, so the count has to come from the pure chunker: short
    // sentences merge into one chunk regardless of what playback later says.
    speakerMock.speakText.mockResolvedValue({
      chunks: 99,
      voiceId: "other",
      truncated: true,
    });

    await expect(
      ttsSpeakCommand({ text: "Primera frase. Segunda frase." }),
    ).resolves.toEqual({
      voiceId: "v-es",
      chunks: 1,
      truncated: false,
      started: true,
    });
    expect(speakerMock.speakText).toHaveBeenCalledWith(
      "Primera frase. Segunda frase.",
      { voiceId: "v-es" },
    );
  });

  it("fails the command when nothing resolves to a voice", async () => {
    voiceMock.resolveActiveVoice.mockResolvedValue(null);

    await expect(ttsSpeakCommand({ text: "hola" })).rejects.toMatchObject({
      code: "command_failed",
    });
    expect(speakerMock.speakText).not.toHaveBeenCalled();
  });

  it("fails the command when the text has nothing speakable", async () => {
    voiceMock.resolveActiveVoice.mockResolvedValue(voice);

    await expect(
      ttsSpeakCommand({ text: "\u001b[31m\u001b[0m" }),
    ).rejects.toMatchObject({
      code: "command_failed",
    });
    expect(speakerMock.speakText).not.toHaveBeenCalled();
  });

  it("does not reject when playback fails after the queue started", async () => {
    voiceMock.resolveActiveVoice.mockResolvedValue(voice);
    speakerMock.speakText.mockRejectedValue(new Error("engine died"));

    await expect(ttsSpeakCommand({ text: "hola" })).resolves.toMatchObject({
      started: true,
    });
  });

  it("reports whether stopping actually silenced something", () => {
    speakerMock.stopSpeaking.mockReturnValue(false);
    expect(ttsStopSpeakingCommand()).toEqual({ stopped: false });
  });
});
