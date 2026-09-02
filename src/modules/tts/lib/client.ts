import type { TtsLanguage, TtsModelId } from "./engines";
import type { VoiceParams } from "./voices";

export type TtsEndpoint = {
  port: number;
  token: string;
};

export type TtsSynthesizeRequest = {
  model: TtsModelId;
  text: string;
  language: TtsLanguage;
  voice?: string | null;
  samplePath?: string | null;
  params?: VoiceParams;
};

export type TtsHealth = {
  ok: boolean;
  engine: string;
  device: string;
  loadedModel: TtsModelId | null;
};

export type TtsPresetVoice = {
  id: string;
  label: string;
  language: TtsLanguage | "other";
};

export type TtsClientErrorCode =
  | "invalid-endpoint"
  | "unauthorized"
  | "bad-request"
  | "model-missing"
  | "loading"
  | "server"
  | "network"
  | "timeout"
  | "aborted";

export class TtsClientError extends Error {
  readonly code: TtsClientErrorCode;
  readonly status: number | null;

  constructor(
    code: TtsClientErrorCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "TtsClientError";
    this.code = code;
    this.status = status;
  }
}

export const DEFAULT_SYNTHESIZE_TIMEOUT_MS = 120_000;
const CONTROL_TIMEOUT_MS = 15_000;

/**
 * The sidecar is a local process bound to 127.0.0.1. Text reaching any other
 * host would leave the machine, so the check is a hard failure, not a warning.
 */
export function assertLoopbackUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TtsClientError("invalid-endpoint", `Invalid TTS URL: ${url}`);
  }
  if (parsed.protocol !== "http:") {
    throw new TtsClientError(
      "invalid-endpoint",
      "The TTS sidecar is reachable over plain HTTP on loopback only.",
    );
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback =
    host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
  if (!loopback) {
    throw new TtsClientError(
      "invalid-endpoint",
      "The TTS sidecar must run on a loopback address to keep speech local.",
    );
  }
}

export function endpointUrl(port: number, path: string): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TtsClientError("invalid-endpoint", `Invalid TTS port: ${port}`);
  }
  const url = `http://127.0.0.1:${port}${path.startsWith("/") ? path : `/${path}`}`;
  assertLoopbackUrl(url);
  return url;
}

type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

async function errorFor(res: Response): Promise<TtsClientError> {
  let detail = "";
  try {
    const body = await res.text();
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: unknown };
        detail = typeof parsed.error === "string" ? parsed.error : body;
      } catch {
        detail = body;
      }
    }
  } catch {
    detail = "";
  }
  const suffix = detail ? `: ${detail}` : "";
  switch (res.status) {
    case 400:
      return new TtsClientError(
        "bad-request",
        `The engine rejected the request${suffix}`,
        400,
      );
    case 401:
    case 403:
      return new TtsClientError(
        "unauthorized",
        "The speech engine refused the session token. Restart the engine.",
        res.status,
      );
    case 404:
      return new TtsClientError(
        "model-missing",
        `That model is not downloaded yet${suffix}`,
        404,
      );
    case 503:
      return new TtsClientError(
        "loading",
        `The engine is still loading the model${suffix}`,
        503,
      );
    default:
      return new TtsClientError(
        "server",
        `The speech engine failed (${res.status})${suffix}`,
        res.status,
      );
  }
}

async function request(
  endpoint: TtsEndpoint,
  path: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<Response> {
  const url = endpointUrl(endpoint.port, path);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? CONTROL_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const external = options.signal;
  const onAbort = () => controller.abort();
  external?.addEventListener("abort", onAbort, { once: true });
  if (external?.aborted) controller.abort();

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${endpoint.token}`,
      },
    });
    if (!res.ok) throw await errorFor(res);
    return res;
  } catch (err) {
    if (err instanceof TtsClientError) throw err;
    if (timedOut) {
      throw new TtsClientError(
        "timeout",
        `The speech engine did not answer within ${Math.round(timeoutMs / 1000)}s.`,
      );
    }
    if (external?.aborted) {
      throw new TtsClientError("aborted", "Speech was stopped.");
    }
    throw new TtsClientError(
      "network",
      err instanceof Error ? err.message : "Could not reach the speech engine.",
    );
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }
}

export async function synthesize(
  endpoint: TtsEndpoint,
  body: TtsSynthesizeRequest,
  options: RequestOptions = {},
): Promise<Blob> {
  const res = await request(
    endpoint,
    "/synthesize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: body.model,
        text: body.text,
        language: body.language,
        ...(body.voice ? { voice: body.voice } : {}),
        ...(body.samplePath ? { samplePath: body.samplePath } : {}),
        ...(body.params && Object.keys(body.params).length > 0
          ? { params: body.params }
          : {}),
      }),
    },
    { ...options, timeoutMs: options.timeoutMs ?? DEFAULT_SYNTHESIZE_TIMEOUT_MS },
  );
  return res.blob();
}

export async function health(
  endpoint: TtsEndpoint,
  options: RequestOptions = {},
): Promise<TtsHealth> {
  const res = await request(endpoint, "/health", { method: "GET" }, options);
  return (await res.json()) as TtsHealth;
}

export async function voices(
  endpoint: TtsEndpoint,
  model: TtsModelId,
  options: RequestOptions = {},
): Promise<TtsPresetVoice[]> {
  const res = await request(
    endpoint,
    `/voices?model=${encodeURIComponent(model)}`,
    { method: "GET" },
    options,
  );
  const parsed = (await res.json()) as { voices?: unknown };
  if (!Array.isArray(parsed.voices)) return [];
  return parsed.voices.filter(
    (entry): entry is TtsPresetVoice =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as TtsPresetVoice).id === "string",
  );
}

export async function warmup(
  endpoint: TtsEndpoint,
  model: TtsModelId,
  options: RequestOptions = {},
): Promise<void> {
  await request(
    endpoint,
    "/warmup",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    },
    { ...options, timeoutMs: options.timeoutMs ?? DEFAULT_SYNTHESIZE_TIMEOUT_MS },
  );
}
