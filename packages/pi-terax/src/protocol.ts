export const PROTOCOL_VERSION = 1;
// A 48 KiB UTF-8 Mermaid source can expand to six JSON bytes per source byte
// when it contains escaped control characters. Keep a bounded margin for the
// authenticated request envelope and optional title.
export const MAX_FRAME_BYTES = 384 * 1024;

export type TeraxResponse =
  | {
      version: 1;
      id: string;
      ok: true;
      value?: unknown;
    }
  | {
      version: 1;
      id: string;
      ok: false;
      error?: {
        code: string;
        message: string;
      };
    };

export function encodeRequest(input: {
  id: string;
  token: string;
  command: string;
  payload?: unknown;
}): string {
  return `${JSON.stringify({
    version: PROTOCOL_VERSION,
    id: input.id,
    token: input.token,
    command: input.command,
    payload: input.payload ?? null,
  })}\n`;
}

export function decodeResponse(line: string, expectedId: string): TeraxResponse {
  const parsed = JSON.parse(line) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid Terax bridge response");
  }
  const response = parsed as Record<string, unknown>;
  if (response.version !== PROTOCOL_VERSION || response.id !== expectedId) {
    throw new Error("Invalid Terax bridge response");
  }
  if (response.ok === true) {
    return {
      version: PROTOCOL_VERSION,
      id: expectedId,
      ok: true,
      value: response.value,
    };
  }
  if (response.ok === false) {
    const error =
      typeof response.error === "object" &&
      response.error !== null &&
      !Array.isArray(response.error)
        ? (response.error as Record<string, unknown>)
        : undefined;
    return {
      version: PROTOCOL_VERSION,
      id: expectedId,
      ok: false,
      error: {
        code: typeof error?.code === "string" ? error.code : "bridge_error",
        message:
          typeof error?.message === "string"
            ? error.message
            : "Terax bridge request failed",
      },
    };
  }
  throw new Error("Invalid Terax bridge response");
}
