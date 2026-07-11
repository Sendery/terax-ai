import { Socket } from "node:net";
import type { TeraxCommandId } from "./commands.js";
import type { TeraxDiscovery } from "./discovery.js";
import {
  decodeResponse,
  encodeRequest,
  MAX_FRAME_BYTES,
} from "./protocol.js";

export type TeraxClientOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 5_000;
let nextId = 1;

function requestId(): string {
  return String(nextId++);
}

export class TeraxClient {
  private readonly discovery: TeraxDiscovery;
  private readonly timeoutMs: number;
  private readonly signal?: AbortSignal;

  constructor(discovery: TeraxDiscovery, options: TeraxClientOptions = {}) {
    this.discovery = discovery;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.signal = options.signal;
  }

  call(command: TeraxCommandId, payload?: unknown): Promise<unknown> {
    const id = requestId();
    const socket = new Socket();
    let buffer = "";
    let settled = false;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        this.signal?.removeEventListener("abort", onAbort);
        socket.destroy();
      };

      const fail = (error: Error) => {
        if (settled) return;
        cleanup();
        reject(error);
      };

      const timer = setTimeout(() => {
        fail(new Error("Terax bridge request timed out"));
      }, this.timeoutMs);

      const onAbort = () => {
        fail(new Error("Terax bridge request aborted"));
      };

      if (this.signal?.aborted) {
        onAbort();
        return;
      }
      this.signal?.addEventListener("abort", onAbort, { once: true });

      socket.setEncoding("utf8");
      socket.on("error", (error) => fail(error));
      socket.on("connect", () => {
        socket.write(
          encodeRequest({
            id,
            token: this.discovery.token,
            command,
            payload,
          }),
        );
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, "utf8") > MAX_FRAME_BYTES) {
          fail(new Error("Terax bridge response exceeded frame cap"));
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        try {
          const response = decodeResponse(line, id);
          cleanup();
          if (response.ok) resolve(response.value);
          else reject(new Error(response.error?.message ?? "Terax bridge error"));
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.connect(this.discovery.port, "127.0.0.1");
    });
  }
}
