import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { TeraxClient } from "../src/client.js";
import type { TeraxDiscovery } from "../src/discovery.js";

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

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close();
});

describe("TeraxClient", () => {
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
