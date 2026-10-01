import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertLoopbackUrl,
  endpointUrl,
  health,
  synthesize,
  TtsClientError,
  voices,
  warmup,
  type TtsSynthesizeRequest,
} from "./client";

const ENDPOINT = { port: 51_000, token: "t0ken" };

const REQUEST: TtsSynthesizeRequest = {
  model: "kokoro-82m",
  text: "hola",
  language: "es-ES",
  voice: "ef_dora",
  params: { speed: 1.2 },
};

function mockFetch(response: Response | Error) {
  const fn = vi.fn(async (_url: string, _init: RequestInit = {}) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loopback assertion", () => {
  it("accepts loopback hosts only", () => {
    expect(() => assertLoopbackUrl("http://127.0.0.1:9000/health")).not.toThrow();
    expect(() => assertLoopbackUrl("http://localhost:9000/health")).not.toThrow();
    expect(() => assertLoopbackUrl("http://[::1]:9000/health")).not.toThrow();
    expect(() =>
      assertLoopbackUrl("http://127.1.2.3:9000/health"),
    ).not.toThrow();
  });

  it("refuses any other host, scheme or malformed url", () => {
    for (const url of [
      "http://example.com/synthesize",
      "http://10.0.0.5:9000/synthesize",
      "http://127.0.0.1.evil.com/synthesize",
      "https://127.0.0.1:9000/synthesize",
      "file:///etc/passwd",
      "not a url",
    ]) {
      const call = () => assertLoopbackUrl(url);
      expect(call).toThrow(TtsClientError);
      try {
        call();
      } catch (err) {
        expect((err as TtsClientError).code).toBe("invalid-endpoint");
      }
    }
  });

  it("builds a loopback url and refuses an impossible port", () => {
    expect(endpointUrl(51_000, "/health")).toBe("http://127.0.0.1:51000/health");
    expect(endpointUrl(51_000, "health")).toBe("http://127.0.0.1:51000/health");
    for (const port of [0, -1, 70_000, 1.5, Number.NaN]) {
      expect(() => endpointUrl(port, "/health")).toThrow(TtsClientError);
    }
  });
});

describe("synthesize", () => {
  it("posts json with the bearer token and returns the audio blob", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" });
    const fetchMock = mockFetch(
      new Response(blob, { status: 200, headers: { "Content-Type": "audio/wav" } }),
    );
    const out = await synthesize(ENDPOINT, REQUEST);
    expect(out.size).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:51000/synthesize");
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer t0ken");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "kokoro-82m",
      text: "hola",
      language: "es-ES",
      voice: "ef_dora",
      params: { speed: 1.2 },
    });
  });

  it("omits absent optional fields instead of sending nulls", async () => {
    const fetchMock = mockFetch(new Response(new Blob(["x"]), { status: 200 }));
    await synthesize(ENDPOINT, {
      model: "kokoro-82m",
      text: "hola",
      language: "es-ES",
      voice: null,
      samplePath: null,
      params: {},
    });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body),
    );
    expect(body).toEqual({
      model: "kokoro-82m",
      text: "hola",
      language: "es-ES",
    });
  });

  it("never reaches a non-loopback host", async () => {
    const fetchMock = mockFetch(new Response(null, { status: 200 }));
    await expect(synthesize({ port: 0, token: "t" }, REQUEST)).rejects.toThrow(
      TtsClientError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "bad-request"],
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "model-missing"],
    [503, "loading"],
    [500, "server"],
    [418, "server"],
  ])("maps %i to %s", async (status, code) => {
    mockFetch(
      new Response(JSON.stringify({ error: "why" }), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(synthesize(ENDPOINT, REQUEST)).rejects.toMatchObject({
      code,
      status,
    });
  });

  it("maps a transport failure to a network error", async () => {
    mockFetch(new TypeError("Load failed"));
    await expect(synthesize(ENDPOINT, REQUEST)).rejects.toMatchObject({
      code: "network",
    });
  });

  it("maps an external abort to an aborted error", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit = {}) => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    );
    await expect(
      synthesize(ENDPOINT, REQUEST, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("maps its own deadline to a timeout error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    // The assertion has to be attached before the timers advance, otherwise
    // the rejection lands with no handler and vitest reports it as unhandled.
    const pending = expect(
      synthesize(ENDPOINT, REQUEST, { timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(60);
    await pending;
    vi.useRealTimers();
  });
});

describe("control endpoints", () => {
  it("reads health", async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          ok: true,
          engine: "kokoro",
          device: "cpu",
          loadedModel: "kokoro-82m",
        }),
        { status: 200 },
      ),
    );
    await expect(health(ENDPOINT)).resolves.toMatchObject({
      ok: true,
      loadedModel: "kokoro-82m",
    });
  });

  it("lists presets and tolerates a malformed payload", async () => {
    const fetchMock = mockFetch(
      new Response(
        JSON.stringify({
          voices: [
            { id: "ef_dora", label: "Dora", language: "es-ES" },
            { label: "no id" },
          ],
        }),
        { status: 200 },
      ),
    );
    await expect(voices(ENDPOINT, "kokoro-82m")).resolves.toEqual([
      { id: "ef_dora", label: "Dora", language: "es-ES" },
    ]);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://127.0.0.1:51000/voices?model=kokoro-82m",
    );

    mockFetch(new Response(JSON.stringify({}), { status: 200 }));
    await expect(voices(ENDPOINT, "kokoro-82m")).resolves.toEqual([]);
  });

  it("warms a model up", async () => {
    const fetchMock = mockFetch(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await warmup(ENDPOINT, "kokoro-82m");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:51000/warmup");
    expect(JSON.parse(String(init.body))).toEqual({ model: "kokoro-82m" });
  });
});
