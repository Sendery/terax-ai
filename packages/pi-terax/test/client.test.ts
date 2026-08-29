import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { TeraxClient } from "../src/client.js";
import type { TeraxDiscovery } from "../src/discovery.js";
import { encodeRequest, MAX_FRAME_BYTES } from "../src/protocol.js";

const sockets: Socket[] = [];
const servers: Awaited<ReturnType<typeof listenServer>>[] = [];

async function listenServer(onSocket: (socket: Socket) => void) {
  const server = createServer((socket) => {
    sockets.push(socket);
    onSocket(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { port: address.port, close };
}

function discovery(port: number): TeraxDiscovery {
  return { version: 1, pid: 1, port, token: "tok" };
}

function responseLine(
  id: string,
  targetBytes: number,
): { line: string; value: string } {
  const prefix = `{"version":1,"id":"${id}","ok":true,"value":"`;
  const suffix = '"}';
  const value = "x".repeat(
    targetBytes -
      Buffer.byteLength(prefix, "utf8") -
      Buffer.byteLength(suffix, "utf8"),
  );
  return { line: `${prefix}${value}${suffix}`, value };
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close();
});

describe("TeraxClient", () => {
  it("fits every accepted 48 KiB Mermaid source in one request frame", () => {
    const source = "\u0001".repeat(48 * 1024);
    const frame = encodeRequest({
      id: "1",
      token: "a".repeat(64),
      command: "mermaid.open",
      payload: { source, title: "Mermaid" },
    });

    expect(Buffer.byteLength(source, "utf8")).toBe(48 * 1024);
    expect(Buffer.byteLength(frame, "utf8")).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });

  it("handles response frames split across chunks", async () => {
    const server = await listenServer((socket) => {
      socket.once("data", () => {
        socket.write('{"version":1,"id":"');
        socket.write('1","ok":true,"value":{"ready":true}}\n');
      });
    });
    servers.push(server);

    const client = new TeraxClient(discovery(server.port));
    await expect(client.call("app.snapshot")).resolves.toEqual({
      ready: true,
    });
  });

  it("accepts an exact-cap response when the newline delimiter is excluded", async () => {
    let expectedValue = "";
    const server = await listenServer((socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString().trim()) as { id: string };
        const response = responseLine(request.id, MAX_FRAME_BYTES);
        expectedValue = response.value;
        socket.write(`${response.line}\n`);
      });
    });
    servers.push(server);

    const value = await new TeraxClient(discovery(server.port)).call("app.snapshot");
    expect(value).toBe(expectedValue);
  });

  it("rejects a response one byte over the frame cap", async () => {
    const server = await listenServer((socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString().trim()) as { id: string };
        const response = responseLine(request.id, MAX_FRAME_BYTES + 1);
        socket.write(`${response.line}\n`);
      });
    });
    servers.push(server);

    await expect(
      new TeraxClient(discovery(server.port)).call("app.snapshot"),
    ).rejects.toThrow("Terax bridge response exceeded frame cap");
  });

  it("times out when the bridge does not respond", async () => {
    const server = await listenServer(() => {});
    servers.push(server);

    const client = new TeraxClient(discovery(server.port), { timeoutMs: 20 });
    await expect(client.call("app.snapshot")).rejects.toThrow(
      "Terax bridge request timed out",
    );
  });

  it("honors abort signals", async () => {
    const server = await listenServer(() => {});
    servers.push(server);
    const controller = new AbortController();
    const client = new TeraxClient(discovery(server.port), {
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    const pending = client.call("app.snapshot");
    controller.abort();

    await expect(pending).rejects.toThrow("Terax bridge request aborted");
  });
});
