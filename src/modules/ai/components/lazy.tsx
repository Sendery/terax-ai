import type { PresenceState } from "@/lib/usePresence";
import { lazy, Suspense } from "react";
import type { AgentRunBridgeProps } from "./AgentRunBridge";

const AgentRunBridgeInner = lazy(() =>
  import("./AgentRunBridge").then((m) => ({ default: m.AgentRunBridge })),
);

const AiMiniWindowInner = lazy(() =>
  import("./AiMiniWindow").then((m) => ({ default: m.AiMiniWindow })),
);

const AiChatDockInner = lazy(() =>
  import("./AiChatDock").then((m) => ({ default: m.AiChatDock })),
);

const AiChatBottomPaneInner = lazy(() =>
  import("./AiChatDock").then((m) => ({ default: m.AiChatBottomPane })),
);

const AiInputBarConnectInner = lazy(() =>
  import("./AiInputBar").then((m) => ({ default: m.AiInputBarConnect })),
);

export function AgentRunBridge(props: AgentRunBridgeProps) {
  return (
    <Suspense fallback={null}>
      <AgentRunBridgeInner {...props} />
    </Suspense>
  );
}

export function AiMiniWindow({ state }: { state: PresenceState }) {
  return (
    <Suspense fallback={null}>
      <AiMiniWindowInner state={state} />
    </Suspense>
  );
}

export function AiChatDock(props: {
  side: "left" | "right";
  state: PresenceState;
}) {
  return (
    <Suspense fallback={null}>
      <AiChatDockInner {...props} />
    </Suspense>
  );
}

export function AiChatBottomPane({ state }: { state: PresenceState }) {
  return (
    <Suspense fallback={null}>
      <AiChatBottomPaneInner state={state} />
    </Suspense>
  );
}

export function AiInputBarConnect({
  onAdd,
  onDismiss,
}: {
  onAdd: () => void;
  onDismiss: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <AiInputBarConnectInner onAdd={onAdd} onDismiss={onDismiss} />
    </Suspense>
  );
}
