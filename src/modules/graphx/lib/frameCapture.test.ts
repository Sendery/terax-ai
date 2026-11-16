import { afterEach, expect, it, vi } from "vitest";
import {
  graphRenderReceipt,
  requestGraphCapture,
} from "@/modules/graphx/lib/frameCapture";

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const listeners = new Set<(event: MessageEvent) => void>();
  vi.stubGlobal("window", {
    addEventListener: (
      _type: string,
      listener: (event: MessageEvent) => void,
    ) => listeners.add(listener),
    removeEventListener: (
      _type: string,
      listener: (event: MessageEvent) => void,
    ) => listeners.delete(listener),
  });
  const target = { postMessage: vi.fn() };
  const frame = {
    contentWindow: target,
    clientWidth: 500,
    clientHeight: 350,
  } as unknown as HTMLIFrameElement;
  const controller = new AbortController();
  const owner = {
    token: "fresh-token",
    documentId: "incarnation",
    revision: 3,
  };
  let current = true;
  const pending = requestGraphCapture(frame, owner, {
    signal: controller.signal,
    current: () => current,
  });
  const request = target.postMessage.mock.calls[0][0];
  const result = {
    ...request,
    type: "terax:graphx:captured",
    width: 500,
    height: 350,
    png: "data:image/png;base64,aGVsbG8=",
    receipt: { styled: true, nodes: 3, paths: 8, width: 498, height: 306 },
  };
  const reply = (data = result, source: unknown = target) => {
    for (const listener of listeners)
      listener({ source, data } as MessageEvent);
  };
  return {
    pending,
    controller,
    request,
    target,
    result,
    reply,
    listeners,
    retire: () => {
      current = false;
    },
  };
}
it("accepts only the exact frame, session, incarnation, revision and snapshot request", async () => {
  const f = fixture();
  f.reply(f.result, {});
  for (const patch of [
    { token: "old" },
    { documentId: "recreated" },
    { revision: 2 },
    { requestId: "old" },
  ])
    f.reply({ ...f.result, ...patch });
  expect(f.listeners.size).toBe(1);
  f.reply();
  await expect(f.pending).resolves.toBe(f.result.png);
  expect(f.listeners.size).toBe(0);
});
it("cancels the owned request and removes listeners before a late PNG can arrive", async () => {
  const f = fixture();
  const rejected = expect(f.pending).rejects.toThrow("cancelled");
  f.controller.abort();
  await rejected;
  expect(f.listeners.size).toBe(0);
  expect(f.target.postMessage.mock.calls[1][0]).toMatchObject({
    ...f.request,
    type: "terax:graphx:cancel-capture",
  });
  f.reply();
});
it("rejects a retired owner even when its matching PNG arrives", async () => {
  const f = fixture();
  f.retire();
  f.reply();
  await expect(f.pending).rejects.toThrow("no longer available");
});
it.each([
  { width: 9000 },
  { height: 0 },
  { png: "data:image/svg+xml,unsafe" },
  { png: `data:image/png;base64,${"A".repeat(12 * 1024 * 1024)}` },
  { receipt: null },
  { type: "terax:graphx:capture-error" },
])("refuses invalid or unavailable frame pixels: %j", async (patch) => {
  const f = fixture();
  f.reply({ ...f.result, ...patch } as typeof f.result);
  await expect(f.pending).rejects.toThrow("unavailable");
  expect(f.listeners.size).toBe(0);
});
it("validates actual SVG geometry receipts without accepting arbitrary markup", () => {
  expect(
    graphRenderReceipt({
      styled: true,
      nodes: 3,
      paths: 12,
      width: 700,
      height: 400,
    }),
  ).toEqual({ styled: true, nodes: 3, paths: 12, width: 700, height: 400 });
  expect(
    graphRenderReceipt({ nodes: "<script>", paths: 0, width: 1, height: 2 }),
  ).toBeNull();
  expect(
    graphRenderReceipt({ nodes: 1, paths: 2, width: 0, height: 2 }),
  ).toBeNull();
});

it("rejects an unstyled default-size SVG even when it contains graph geometry", () => {
  expect(
    graphRenderReceipt({ nodes: 3, paths: 24, width: 300, height: 150 }),
  ).toBeNull();
  expect(
    graphRenderReceipt({
      styled: false,
      nodes: 3,
      paths: 24,
      width: 300,
      height: 150,
    }),
  ).toBeNull();
});
