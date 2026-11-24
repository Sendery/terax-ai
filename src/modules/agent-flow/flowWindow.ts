import type { FlowBranch } from "@/modules/agent-flow/scene";
import type { FlowData } from "@/modules/agent-flow/useFlowData";

export const FLOW_WINDOW = "agent-flow";
export const FLOW_REQUEST = "agent-flow:request";
export const FLOW_SNAPSHOT = "agent-flow:snapshot";
export const FLOW_CLOSED = "agent-flow:closed";
export const FLOW_DIFF_RESULT = "agent-flow:diff-result";

export type FlowWindowRequest =
  | { kind: "ready" | "refresh" | "dock" }
  | { kind: "activate"; tabId: number; leafId: number }
  | { kind: "diff"; id: string; runKey: string; path: string };

export type FlowWindowSnapshot = {
  data: Omit<FlowData, "hidden">;
  background?: FlowBranch;
};

export function windowSnapshot(data: FlowData, background?: FlowBranch): FlowWindowSnapshot {
  const { hidden, ...publicData } = data;
  const publicLeaves = new Set(data.panes.map(({ leafId }) => leafId));
  const digests = Object.fromEntries(Object.entries(data.digests ?? {}).filter(([leaf]) => publicLeaves.has(Number(leaf))));
  const deliveries = data.deliveries?.filter(({ source, target }) =>
    !hidden.has(target.shellKey) && (!source || !hidden.has(source.shellKey)));
  const notifications = data.notifications?.filter(({ source, leafId }) => source === "terminal" && publicLeaves.has(leafId))
    .map(({ text: _text, body: _body, subtitle: _subtitle, ...notice }) => notice);
  return { data: { ...publicData, digests, deliveries: deliveries ?? null, notifications: notifications ?? null }, background };
}
