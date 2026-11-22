import { registerFrameCaptureProvider } from "@/modules/capture/lib/frameCapture";
import {
  graphRenderReceipt,
  requestGraphCapture,
} from "@/modules/graphx/lib/frameCapture";
import { parseGraphSource } from "@/modules/graphx/lib/document";
import type { GraphTab } from "@/modules/tabs";
import { useTheme } from "@/modules/theme";
import { useEffect, useRef, useState } from "react";
type GraphFrameProps = {
  tab: Pick<GraphTab, "documentId" | "revision" | "source" | "title">;
  /** `source` is Mermaid, converted inside the frame, instead of GraphX JSON. */
  mermaid?: boolean;
  /** The frame's converter refused the Mermaid source; the message says why. */
  onMermaidError?: (message: string) => void;
  /** Mermaid statements the converter read but could not draw. */
  onMermaidWarnings?: (warnings: string[]) => void;
};
export function GraphFrame(props: GraphFrameProps) {
  const { resolvedMode } = useTheme();
  const { tab } = props;
  return (
    <GraphFrameSession
      key={`${tab.documentId}:${tab.revision}:${resolvedMode}`}
      {...props}
      theme={resolvedMode}
    />
  );
}
function boundedStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.slice(0, 300));
}
function GraphFrameSession({
  tab,
  theme,
  mermaid = false,
  onMermaidError,
  onMermaidWarnings,
}: GraphFrameProps & { theme: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const token = useRef(crypto.randomUUID()).current;
  const [ready, setReady] = useState(false);
  const [state, setState] = useState("Loading GraphX...");
  const [receipt, setReceipt] = useState("");
  const mermaidCallbacks = useRef({ onMermaidError, onMermaidWarnings });
  useEffect(() => {
    mermaidCallbacks.current = { onMermaidError, onMermaidWarnings };
  }, [onMermaidError, onMermaidWarnings]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const message = "GraphX is taking longer than expected.";
      setState(message);
      if (mermaid) mermaidCallbacks.current.onMermaidError?.(message);
    }, 15000);
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
        if (mermaid)
          mermaidCallbacks.current.onMermaidWarnings?.(
            boundedStrings(event.data.warnings, 20),
          );
      }
      if (event.data.type === "terax:graphx:error") {
        window.clearTimeout(timeout);
        if (mermaid) {
          setState("GraphX cannot draw this Mermaid diagram.");
          const message =
            typeof event.data.message === "string"
              ? event.data.message.slice(0, 300)
              : "This Mermaid source could not be converted.";
          mermaidCallbacks.current.onMermaidError?.(message);
          return;
        }
        setState(
          event.data.reason === "styles"
            ? "GraphX styles are unavailable. Reopen this tab."
            : mermaid
              ? "Layout failed. Edit the Mermaid source."
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
  }, [token, tab.revision, tab.documentId, mermaid]);
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
        ...(mermaid
          ? { mermaid: tab.source, title: tab.title }
          : { spec: parseGraphSource(tab.source) }),
        revision: tab.revision,
        documentId: tab.documentId,
        theme,
      },
      "*",
    );
  }, [
    ready,
    tab.source,
    tab.title,
    tab.revision,
    tab.documentId,
    token,
    theme,
    mermaid,
  ]);
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
