import { registerFrameCaptureProvider } from "@/modules/capture/lib/frameCapture";
import {
  graphRenderReceipt,
  requestGraphCapture,
} from "@/modules/graphx/lib/frameCapture";
import { parseGraphSource } from "@/modules/graphx/lib/document";
import type { GraphTab } from "@/modules/tabs";
import { useTheme } from "@/modules/theme";
import { useEffect, useRef, useState } from "react";
export function GraphFrame({
  tab,
}: {
  tab: Pick<GraphTab, "documentId" | "revision" | "source" | "title">;
}) {
  const { resolvedMode } = useTheme();
  return (
    <GraphFrameSession
      key={`${tab.documentId}:${tab.revision}:${resolvedMode}`}
      tab={tab}
      theme={resolvedMode}
    />
  );
}
function GraphFrameSession({
  tab,
  theme,
}: {
  tab: Pick<GraphTab, "documentId" | "revision" | "source" | "title">;
  theme: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const token = useRef(crypto.randomUUID()).current;
  const [ready, setReady] = useState(false);
  const [state, setState] = useState("Loading GraphX...");
  const [receipt, setReceipt] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(
      () =>
        setState(
          "GraphX is taking longer than expected. Reopen this tab if it does not finish.",
        ),
      15000,
    );
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.token !== token
      )
        return;
      if (event.data.type === "terax:graphx:ready") setReady(true);
      if (
        event.data.revision !== tab.revision ||
        event.data.documentId !== tab.documentId
      )
        return;
      if (event.data.type === "terax:graphx:rendered") {
        const geometry = graphRenderReceipt(event.data.receipt);
        if (!geometry) return;
        window.clearTimeout(timeout);
        setState("");
        setReceipt(
          `GraphX rendered revision ${tab.revision}: ${geometry.nodes} nodes, ${geometry.paths} paths, ${geometry.width} by ${geometry.height} pixels.`,
        );
      }
      if (event.data.type === "terax:graphx:error") {
        window.clearTimeout(timeout);
        setState(
          event.data.reason === "styles"
            ? "GraphX styles are unavailable. Reopen this tab."
            : "Layout failed. Edit the JSON and apply again.",
        );
      }
    };
    window.addEventListener("message", receive);
    frame.current?.contentWindow?.postMessage(
      { type: "terax:graphx:hello", token },
      "*",
    );
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [token, tab.revision, tab.documentId]);
  useEffect(() => {
    const current = frame.current;
    if (!current) return;
    return registerFrameCaptureProvider(current, (scope) =>
      requestGraphCapture(
        current,
        { token, documentId: tab.documentId, revision: tab.revision },
        scope,
      ),
    );
  }, [token, tab.documentId, tab.revision]);
  useEffect(() => {
    if (!ready) return;
    setState("Laying out graph...");
    frame.current?.contentWindow?.postMessage(
      {
        type: "terax:graphx:render",
        token,
        spec: parseGraphSource(tab.source),
        revision: tab.revision,
        documentId: tab.documentId,
        theme,
      },
      "*",
    );
  }, [ready, tab.source, tab.revision, tab.documentId, token, theme]);
  return (
    <div className="relative min-h-0 flex-1">
      <iframe
        ref={frame}
        data-terax-capture-frame=""
        title={`${tab.title} interactive graph`}
        sandbox="allow-scripts"
        onLoad={() =>
          frame.current?.contentWindow?.postMessage(
            { type: "terax:graphx:hello", token },
            "*",
          )
        }
        referrerPolicy="no-referrer"
        src={`/graphx/index.html#${token}`}
        className="h-full w-full border-0"
      />
      <span role="status" className="sr-only">
        {receipt}
      </span>
      {state && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/95 px-3 py-1 text-xs"
        >
          {state}
        </div>
      )}
    </div>
  );
}
