import type { Tab } from "@/modules/tabs";
import { leafIdForPty } from "@/modules/terminal";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { integrationForAgent } from "../lib/harnesses";
import { maybeTriggerManagedReview } from "../lib/review";
import { describeAgentEvent } from "../lib/describeEvent";
import { findAgentTab } from "../lib/tabTarget";
import { routeAgentNotification } from "../lib/route";
import type { AgentSession, AgentSignal, NotificationKind } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";

type Activate = (tabId: number, leafId: number) => void;
type Ctx = {
  tabs: Tab[];
  activeId: number;
  focused: boolean;
  onActivate: Activate;
};

function route(
  session: AgentSession,
  kind: NotificationKind,
  ctx: Ctx,
  text?: string | null,
): void {
  const info = findAgentTab(ctx.tabs, session.leafId);
  const described = describeAgentEvent({
    kind,
    agent: session.agent,
    text,
    tabTitle: info?.title ?? "",
  });

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    title: described.title,
    body: described.body,
    focused: ctx.focused,
    visible: ctx.activeId === session.tabId,
    // A turn ends on every reply, so only a genuine block toasts; the rest
    // land in the bell where they can be read in order.
    allowToast: kind === "attention",
    tabId: session.tabId,
    leafId: session.leafId,
    ...(text ? { text } : {}),
    tabTitle: info?.title ?? "",
    tabColor: info?.color ?? null,
    onActivate: () => ctx.onActivate(session.tabId, session.leafId),
  });
}

function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      const info = findAgentTab(ctx.tabs, leafId);
      if (!info) return;
      const harness = integrationForAgent(sig.agent ?? "agent");
      store.start(
        leafId,
        info.tabId,
        sig.agent ?? "agent",
        harness.integration,
        harness.harness,
      );
      return;
    }
    case "working":
      store.setStatus(leafId, "working", "working");
      return;
    case "attention": {
      store.setStatus(leafId, "waiting", "attention");
      const session = store.sessions[leafId];
      if (session) route(session, "attention", ctx, sig.text);
      return;
    }
    case "finished": {
      store.setStatus(leafId, "waiting", "finished");
      const session = store.sessions[leafId];
      if (session) route(session, "turn-end", ctx, sig.text);
      maybeTriggerManagedReview(leafId);
      return;
    }
    case "exited": {
      // The agent process ending is the only event that means the work is
      // over, so it is reported separately from a turn handing back.
      const session = store.sessions[leafId];
      if (session) route(session, "exited", ctx);
      store.finish(leafId);
      useManagedAgentsStore.getState().remove(leafId);
      return;
    }
  }
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

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<AgentSignal>("terax:agent-signal", (e) =>
      handleSignal(e.payload, ctxRef.current),
    )
      .then((u) => {
        if (alive) unlisten = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return null;
}
