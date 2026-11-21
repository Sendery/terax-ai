import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { TtsClientError } from "@/modules/tts/lib/client";
import {
  forgetWarmTranscribers,
  formatSttSpeed,
  NOT_INSTALLED_MESSAGE,
  resolveTranscriber,
  sttSpeedOf,
  transcribePath,
  transcribePcm,
  warmupTranscriber,
} from "./client";

const ENDPOINT = { port: 51_000, token: "t0ken" };
const OPTIONS = {
  model: "rumble-2-flash" as const,
  language: "es-ES" as const,
  filler: false,
  verbatim: false,
  digits: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(...responses: (Response | Error)[]) {
  const fn = vi.fn(async (_url: string, _init: RequestInit = {}) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function status(overrides: Record<string, unknown> = {}, model = { downloaded: true }) {
  return {
    runtime: { installed: true, uvVersion: "0.12.9", pythonVersion: "3.11" },
    engines: [],
    models: [],
    jobs: [],
    diskUsageBytes: 0,
    transcribers: [
      {
        id: "rumble",
        installed: true,
        running: false,
        port: null,
        token: null,
        plan: { supported: true, unsupportedReason: null, device: "mps" },
        ...overrides,
      },
    ],
    transcriberModels: [{ id: "rumble-2-flash", engine: "rumble", ...model }],
  };
}

beforeEach(() => {
  invoke.mockReset();
  forgetWarmTranscribers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("transcribePcm", () => {
  it("posts a 16 kHz WAV with the mode flags and the URL-encoded context", async () => {
    const fetch = mockFetch(
      json({ text: "Hola, qué tal.", language: "Spanish", audioMs: 1000, elapsedMs: 40 }),
    );
    const result = await transcribePcm(ENDPOINT, new Float32Array(16_000), {
      ...OPTIONS,
      context: "Pi-Terax, Kokoro, señal",
    });
    expect(result).toEqual({
      text: "Hola, qué tal.",
      language: "Spanish",
      audioMs: 1000,
      elapsedMs: 40,
    });
    const [url, init = {}] = fetch.mock.calls[0];
    expect(url).toBe(
      "http://127.0.0.1:51000/transcribe?model=rumble-2-flash&language=es-ES&filler=0&verbatim=0&digits=1",
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer t0ken");
    expect(headers["Content-Type"]).toBe("audio/wav");
    expect(decodeURIComponent(headers["X-Terax-Context"])).toBe("Pi-Terax, Kokoro, señal");
    const body = init.body as Blob;
    // 44-byte header plus 2 bytes per sample.
    expect(body.size).toBe(44 + 32_000);
    expect(new TextDecoder().decode(await body.slice(0, 4).arrayBuffer())).toBe("RIFF");
    expect(formatSttSpeed(sttSpeedOf("rumble-2-flash"))).toMatch(/faster than real time/);
  });

  it("sends no context header when there are no terms", async () => {
    const fetch = mockFetch(json({ text: "" }));
    const result = await transcribePcm(ENDPOINT, new Float32Array(160), {
      ...OPTIONS,
      language: "auto",
    });
    expect(result.text).toBe("");
    expect(result.audioMs).toBe(10);
    const [url, init = {}] = fetch.mock.calls[0];
    expect(url).toContain("language=auto");
    expect((init.headers as Record<string, string>)["X-Terax-Context"]).toBeUndefined();
  });

  it("maps refusals to readable errors", async () => {
    mockFetch(json({ error: "wrong_kind", message: "not a transcriber" }, 409));
    await expect(
      transcribePcm(ENDPOINT, new Float32Array(160), OPTIONS),
    ).rejects.toMatchObject({ code: "bad-request", message: expect.stringContaining("not a transcriber") });
    mockFetch(new Response("", { status: 401 }));
    await expect(transcribePcm(ENDPOINT, new Float32Array(160), OPTIONS)).rejects.toBeInstanceOf(
      TtsClientError,
    );
  });

  it("reports cancellation as aborted", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const pending = transcribePcm(ENDPOINT, new Float32Array(160), {
      ...OPTIONS,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("builds the query from the options", () => {
    expect(transcribePath({ ...OPTIONS, verbatim: true, digits: false })).toBe(
      "/transcribe?model=rumble-2-flash&language=es-ES&filler=0&verbatim=1&digits=0",
    );
  });
});

describe("warmupTranscriber", () => {
  it("returns the self-test result", async () => {
    mockFetch(json({ ok: true, selfTest: { ok: true, elapsedMs: 63 } }));
    await expect(warmupTranscriber(ENDPOINT, "rumble-2-flash")).resolves.toEqual({
      ok: true,
      elapsedMs: 63,
    });
    expect(sttSpeedOf("rumble-2-flash")?.selfTest).toEqual({ ok: true, elapsedMs: 63 });
    mockFetch(json({ ok: true }));
    await expect(warmupTranscriber(ENDPOINT, "rumble-2-flash")).resolves.toBeNull();
  });
});

describe("resolveTranscriber", () => {
  it("refuses when the engine is not installed", async () => {
    invoke.mockResolvedValueOnce(status({ installed: false }));
    await expect(resolveTranscriber("rumble-2-flash", "auto")).rejects.toThrow(
      NOT_INSTALLED_MESSAGE,
    );
    invoke.mockResolvedValueOnce({ ...status(), transcribers: undefined });
    await expect(resolveTranscriber("rumble-2-flash", "auto")).rejects.toThrow(
      NOT_INSTALLED_MESSAGE,
    );
  });

  it("refuses when the model is missing or the machine cannot run it", async () => {
    invoke.mockResolvedValueOnce(status({}, { downloaded: false }));
    await expect(resolveTranscriber("rumble-2-flash", "auto")).rejects.toThrow(
      /not downloaded/,
    );
    invoke.mockResolvedValueOnce(
      status({ plan: { supported: false, unsupportedReason: "Needs 64-bit", device: "cpu" } }),
    );
    await expect(resolveTranscriber("rumble-2-flash", "auto")).rejects.toThrow("Needs 64-bit");
  });

  it("starts a stopped engine with the chosen device and warms it once", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "tts_status") return status();
      if (command === "tts_start") return { port: 52_000, token: "abc" };
      throw new Error(command);
    });
    const fetch = mockFetch(json({ ok: true, selfTest: { ok: true, elapsedMs: 5 } }));
    await expect(resolveTranscriber("rumble-2-flash", "cpu")).resolves.toEqual({
      port: 52_000,
      token: "abc",
    });
    expect(invoke).toHaveBeenCalledWith("tts_start", { engine: "rumble", device: "cpu" });
    expect(fetch).toHaveBeenCalledTimes(1);
    await resolveTranscriber("rumble-2-flash", "cpu");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses a running engine and survives a refused warmup", async () => {
    invoke.mockResolvedValue(status({ running: true, port: 53_000, token: "zz" }));
    mockFetch(new Response("", { status: 503 }));
    await expect(resolveTranscriber("rumble-2-flash", "auto")).resolves.toEqual({
      port: 53_000,
      token: "zz",
    });
    expect(invoke).not.toHaveBeenCalledWith("tts_start", expect.anything());
  });
});
