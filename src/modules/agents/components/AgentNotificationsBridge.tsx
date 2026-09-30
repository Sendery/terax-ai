import type { Tab } from "@/modules/tabs";
import { leafIdForPty } from "@/modules/terminal";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { describeAgentEvent } from "../lib/describeEvent";
import { digestForNotification, refreshDigest } from "../lib/digests";
import { displayAgent } from "../lib/format";
import { integrationForAgent } from "../lib/harnesses";
import { maybeTriggerManagedReview } from "../lib/review";
import { routeAgentNotification } from "../lib/route";
import { findAgentTab, findPaneCwd } from "../lib/tabTarget";
import type {
  AgentSession,
  AgentSignal,
  AttentionReason,
  NotificationKind,
} from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { leafOwningPty, useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";

type Activate = (tabId: number, leafId: number) => void;
type Ctx = {
  tabs: Tab[];
  activeId: number;
  focused: boolean;
  onActivate: Activate;
};

async function notify(
  session: AgentSession,
  kind: NotificationKind,
  getCtx: () => Ctx,
  text?: string | null,
  reason?: AttentionReason | null,
): Promise<void> {
  const before = getCtx();
  // The process is already gone on exit, and its digest was read while it ran.
  const digest =
    kind === "exited"
      ? useAgentStore.getState().digests[session.leafId]
      : await digestForNotification(
          session.leafId,
          findPaneCwd(before.tabs, session.leafId),
        );
  // Tabs, focus and the active tab may have changed while the digest was read.
  const ctx = getCtx();
  const info = findAgentTab(ctx.tabs, session.leafId);
  const tabTitle = info?.title ?? "";
  const described = describeAgentEvent({
    kind,
    reason,
    agentLabel: displayAgent(session.agent),
    tabTitle,
    text,
    digest,
    startedAt: session.startedAt,
    tabColor: info?.color ?? null,
  });

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    reason,
    title: described.title,
    subtitle: described.subtitle,
    body: described.body,
    tone: described.tone,
    focused: ctx.focused,
    visible: ctx.activeId === session.tabId,
    tabId: session.tabId,
    leafId: session.leafId,
    ...(text ? { text } : {}),
    tabTitle,
    tabColor: info?.color ?? null,
    ...(digest?.name ? { sessionName: digest.name } : {}),
  });
}

function handleSignal(sig: AgentSignal, getCtx: () => Ctx): void {
  const store = useAgentStore.getState();
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) {
    // The pane closed or respawned its shell before the reader hit EOF, so
    // the pty no longer maps to a leaf; the session it started still does.
    if (sig.kind !== "exited") return;
    const orphan = leafOwningPty(store.sessions, sig.id);
    if (orphan === null) return;
    store.finish(orphan);
    useManagedAgentsStore.getState().remove(orphan);
    return;
  }
  const cwd = () => findPaneCwd(getCtx().tabs, leafId);

  switch (sig.kind) {
    case "started": {
      const info = findAgentTab(getCtx().tabs, leafId);
      if (!info) return;
      const harness = integrationForAgent(sig.agent ?? "agent");
      store.start(
        leafId,
        info.tabId,
        sig.agent ?? "agent",
        harness.integration,
        harness.harness,
        sig.id,
      );
      void refreshDigest(leafId, cwd());
      return;
    }
    case "bound": {
      if (!sig.sessionId) return;
      store.bindSession(leafId, sig.sessionId);
      void refreshDigest(leafId, cwd());
      return;
    }
    case "working":
      store.setStatus(leafId, "working", "working");
      void refreshDigest(leafId, cwd());
      return;
    case "attention": {
      store.setStatus(leafId, "waiting", "attention", sig.reason ?? null);
      const session = useAgentStore.getState().sessions[leafId];
      if (session)
        void notify(session, "attention", getCtx, sig.text, sig.reason);
      return;
    }
    case "finished": {
      store.setStatus(leafId, "waiting", "finished");
      const session = useAgentStore.getState().sessions[leafId];
      if (session) void notify(session, "turn-end", getCtx, sig.text);
      maybeTriggerManagedReview(leafId);
      return;
    }
    case "subagent": {
      // The session carries on; only what it has running changed.
      const session = store.sessions[leafId];
      if (session) void notify(session, "subagent", getCtx, sig.text);
      return;
    }
    case "exited": {
      // The agent process ending is the only event that means the work is
      // over, so it is reported separately from a turn handing back.
      const session = store.sessions[leafId];
      if (session) void notify(session, "exited", getCtx);
      store.finish(leafId);
      useManagedAgentsStore.getState().remove(leafId);
      return;
    }
  }
}

function useListen<T>(event: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<T>(event, (e) => handlerRef.current(e.payload))
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [event]);
}

export function AgentNotificationsBridge({
  tabs,
  activeId,
  onActivate,
}: {
  tabs: Tab[];
  activeId: number;
  onActivate: Activate;
}) {
  const focused = useWindowFocus();
  const ctxRef = useRef<Ctx>({ tabs, activeId, focused, onActivate });
  ctxRef.current = { tabs, activeId, focused, onActivate };

  useListen<AgentSignal>("terax:agent-signal", (signal) =>
    handleSignal(signal, () => ctxRef.current),
  );
  // Clicking a native notification lands on the pane it was about, which is
  // what the in-app toast used to do before notifications moved to the OS.
  useListen<{ leafId?: number | null; tabId?: number | null }>(
    "terax:notification-activated",
    ({ leafId, tabId }) => {
      if (typeof tabId === "number" && typeof leafId === "number") {
        ctxRef.current.onActivate(tabId, leafId);
      }
    },
  );

  return null;
}
