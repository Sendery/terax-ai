import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "../../styles/globals.css";

import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { AgentFlowView } from "@/modules/agent-flow/AgentFlow";
import type { FileCrossing } from "@/modules/agent-flow/coordination";
import { FLOW_DIFF_RESULT, FLOW_REQUEST, FLOW_SNAPSHOT, type FlowWindowRequest, type FlowWindowSnapshot } from "@/modules/agent-flow/flowWindow";
import { ThemeProvider } from "@/modules/theme";

const current = getCurrentWebviewWindow();
const hidden = new Set<string>();

function send(request: FlowWindowRequest) {
  return emitTo("main", FLOW_REQUEST, request);
}

function DetachedAgentFlow() {
  const [snapshot, setSnapshot] = useState<FlowWindowSnapshot>();
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  const requests = useRef(new Map<string, (error?: string) => void>());

  useEffect(() => {
    const subscriptions = [
      current.listen<FlowWindowSnapshot>(FLOW_SNAPSHOT, ({ payload }) => setSnapshot(payload)),
      current.listen<{ id: string; error?: string }>(FLOW_DIFF_RESULT, ({ payload }) => requests.current.get(payload.id)?.(payload.error)),
    ];
    const handshakes = Promise.all(subscriptions);
    void handshakes.then(() => send({ kind: "ready" })).catch(() => setMessage("Agent Flow could not connect to the main window."));
    return () => { for (const subscription of subscriptions) void subscription.then((stop) => stop()).catch(() => {}); };
  }, []);

  function openDiff(file: FileCrossing): Promise<string | undefined> {
    const runKey = file.touches.find(({ operation }) => operation === "write")?.run.key;
    if (!runKey) return Promise.resolve("The Git checkout could not be resolved.");
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish("The main window did not respond."), 5000);
      function finish(error?: string) {
        clearTimeout(timer);
        requests.current.delete(id);
        resolve(error);
      }
      requests.current.set(id, finish);
      void send({ kind: "diff", id, runKey, path: file.path }).catch(() => finish("The Git diff could not be opened."));
    });
  }

  if (!snapshot) return <section className="agent-flow"><p className="flow-window-message" role="status">{message || "Connecting to Agent Flow…"}</p></section>;
  return <AgentFlowView open data={{ ...snapshot.data, hidden }} background={snapshot.background}
    onActivate={(tabId, leafId) => { void send({ kind: "activate", tabId, leafId }).catch(() => {}); }}
    onOpenDiff={openDiff} refresh={refresh} onRefresh={() => {
      setRefresh((value) => value + 1);
      void send({ kind: "refresh" }).catch(() => {});
    }} windowAction={{ label: "Dock", run: () => {
      void send({ kind: "dock" }).then(() => current.close()).catch(() => setMessage("Agent Flow could not return to the main window."));
    } }} windowMessage={message} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ThemeProvider><DetachedAgentFlow /></ThemeProvider>,
);
