import {
  assertCaptureCurrent,
  type CaptureScope,
} from "@/modules/capture/lib/captureLease";

export type GraphFrameOwner = {
  token: string;
  documentId: string;
  revision: number;
};
export type GraphRenderReceipt = {
  styled: true;
  nodes: number;
  paths: number;
  width: number;
  height: number;
};

export function graphRenderReceipt(value: unknown): GraphRenderReceipt | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.styled !== true) return null;
  for (const key of ["nodes", "paths", "width", "height"] as const)
    if (
      !Number.isSafeInteger(item[key]) ||
      (item[key] as number) < 0 ||
      (item[key] as number) > 100000
    )
      return null;
  if (!(item.width as number) || !(item.height as number)) return null;
  return item as GraphRenderReceipt;
}

export function requestGraphCapture(
  frame: HTMLIFrameElement,
  owner: GraphFrameOwner,
  scope: CaptureScope,
): Promise<string> {
  assertCaptureCurrent(scope);
  const target = frame.contentWindow;
  if (!target)
    return Promise.reject(new Error("Graph capture is unavailable."));
  const requestId = crypto.randomUUID();
  const width = frame.clientWidth,
    height = frame.clientHeight;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", receive);
      scope.signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      target.postMessage(
        { type: "terax:graphx:cancel-capture", ...owner, requestId },
        "*",
      );
      reject(new Error("Graph capture was cancelled."));
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (
        event.source !== target ||
        data?.token !== owner.token ||
        data?.documentId !== owner.documentId ||
        data?.revision !== owner.revision ||
        data?.requestId !== requestId
      )
        return;
      if (
        data.type !== "terax:graphx:captured" &&
        data.type !== "terax:graphx:capture-error"
      )
        return;
      cleanup();
      try {
        assertCaptureCurrent(scope);
        if (
          frame.contentWindow !== target ||
          data.type === "terax:graphx:capture-error" ||
          data.width !== width ||
          data.height !== height ||
          !graphRenderReceipt(data.receipt) ||
          typeof data.png !== "string" ||
          data.png.length > 12 * 1024 * 1024 ||
          !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.png)
        )
          throw new Error(
            "Graph capture is unavailable. Wait for layout to finish and retry.",
          );
        resolve(data.png);
      } catch (error) {
        reject(error);
      }
    };
    window.addEventListener("message", receive);
    scope.signal.addEventListener("abort", abort, { once: true });
    if (scope.signal.aborted) abort();
    else
      target.postMessage(
        { type: "terax:graphx:capture", ...owner, requestId },
        "*",
      );
  });
}
