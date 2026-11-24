import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import { useFlowBackground } from "@/modules/agent-flow/background";
import {
  FLOW_CLOSED, FLOW_DIFF_RESULT, FLOW_REQUEST, FLOW_SNAPSHOT, FLOW_WINDOW, windowSnapshot, type FlowWindowRequest,
} from "@/modules/agent-flow/flowWindow";
import { useFlowData } from "@/modules/agent-flow/useFlowData";
import type { Tab } from "@/modules/tabs/lib/useTabs";

export function FlowWindowBridge({ tabs, onActivate, onDock }: {
  tabs: readonly Tab[];
  onActivate: (tabId: number, leafId: number) => void;
  onDock: () => void;
}) {
  const [connection, setConnection] = useState(0);
  const connected = connection > 0;
  const [refresh, setRefresh] = useState(0);
  const data = useFlowData(tabs, connected, refresh);
  const background = useFlowBackground(connected);
  const latest = useRef({ data, onActivate, onDock });
  latest.current = { data, onActivate, onDock };
  const { runs, children, digests, panes, hidden, deliveries, notifications, loading, failed } = data;

  useEffect(() => {
    if (!isTauri()) return;
    const main = getCurrentWebviewWindow();
    async function openDiff(request: Extract<FlowWindowRequest, { kind: "diff" }>) {
      const run = latest.current.data.runs.find(({ key }) => key === request.runKey);
      let error: string | undefined = "The Git diff could not be opened.";
      if (run?.cwd && typeof request.path === "string") {
        try {
          const { openFlowDiff } = await import("@/modules/agent-flow/FlowRelationDetails");
          error = await openFlowDiff(run.cwd, request.path);
          if (!error) await main.setFocus();
        } catch {
          error = "The Git diff could not be opened.";
        }
      }
      await emitTo(FLOW_WINDOW, FLOW_DIFF_RESULT, { id: request.id, error }).catch(() => {});
    }
    const subscriptions = [
      main.listen<FlowWindowRequest>(FLOW_REQUEST, ({ payload }) => {
        if (payload?.kind === "ready") setConnection((value) => value + 1);
        if (payload?.kind === "refresh") setRefresh((value) => value + 1);
        if (payload?.kind === "dock") {
          latest.current.onDock();
          void main.setFocus().catch(() => {});
        }
        if (payload?.kind === "activate" && latest.current.data.panes.some(({ tabId, leafId }) =>
          tabId === payload.tabId && leafId === payload.leafId)) {
          latest.current.onActivate(payload.tabId, payload.leafId);
          void main.setFocus().catch(() => {});
        }
        if (payload?.kind === "diff") void openDiff(payload);
      }),
      main.listen(FLOW_CLOSED, () => setConnection(0)),
    ];
    return () => { for (const subscription of subscriptions) void subscription.then((stop) => stop()).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (!connection) return;
    const snapshot = windowSnapshot({ runs, children, digests, panes, hidden, deliveries, notifications, loading, failed }, background);
    void emitTo(FLOW_WINDOW, FLOW_SNAPSHOT, snapshot).catch(() => {});
  }, [connection, runs, children, digests, panes, hidden, deliveries, notifications, loading, failed, background]);
  return null;
}
