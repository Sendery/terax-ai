import { create } from "zustand";
import type {
  AgentIntegration,
  AgentHarness,
  AgentNotification,
  AgentSession,
  AgentSignalKind,
  AgentStatus,
  AttentionReason,
  LocalAgentState,
  SessionDigest,
} from "../lib/types";

const MAX_NOTIFICATIONS = 50;

let notifSeq = 0;

type AgentStoreState = {
  sessions: Record<number, AgentSession>;
  /** What each live session's transcript says it is, keyed like `sessions`. */
  digests: Record<number, SessionDigest>;
  localAgent: LocalAgentState;
  notifications: AgentNotification[];
  start: (
    leafId: number,
    tabId: number,
    agent: string,
    integration?: AgentIntegration,
    harness?: AgentHarness,
  ) => void;
  setStatus: (
    leafId: number,
    status: AgentStatus,
    signal?: AgentSignalKind,
    reason?: AttentionReason | null,
  ) => void;
  bindSession: (leafId: number, sessionId: string) => void;
  setDigest: (leafId: number, digest: SessionDigest) => void;
  finish: (leafId: number) => void;
  setLocalAgent: (state: LocalAgentState) => void;
  pushNotification: (
    n: Omit<AgentNotification, "id" | "at" | "read">,
  ) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
};

export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: {},
  digests: {},
  localAgent: null,
  notifications: [],

  start: (leafId, tabId, agent, integration = "pty-detection", harness = "generic") =>
    set((s) => {
      const now = Date.now();
      return {
        sessions: {
          ...s.sessions,
          [leafId]: {
            leafId,
            tabId,
            agent,
            status: "working",
            startedAt: now,
            lastActivityAt: now,
            attentionSince: null,
            lastSignal: "started",
            lastReason: null,
            sessionId: null,
            integration,
            harness,
          },
        },
      };
    }),

  setStatus: (leafId, status, signal, reason) =>
    set((s) => {
      const prev = s.sessions[leafId];
      if (!prev || (prev.status === status && signal === undefined)) return s;
      const now = Date.now();
      return {
        sessions: {
          ...s.sessions,
          [leafId]: {
            ...prev,
            status,
            lastActivityAt: now,
            attentionSince: status === "waiting" && signal !== "finished" ? now : null,
            lastSignal: signal ?? prev.lastSignal,
            // A reason only describes the block it came with.
            lastReason: status === "waiting" ? (reason ?? null) : null,
          },
        },
      };
    }),

  bindSession: (leafId, sessionId) =>
    set((s) => {
      const prev = s.sessions[leafId];
      if (!prev || prev.sessionId === sessionId) return s;
      // A different transcript means the previous digest describes another
      // conversation, so it goes with the old binding.
      const digests = { ...s.digests };
      delete digests[leafId];
      return {
        sessions: { ...s.sessions, [leafId]: { ...prev, sessionId } },
        digests,
      };
    }),

  setDigest: (leafId, digest) =>
    set((s) =>
      s.sessions[leafId] ? { digests: { ...s.digests, [leafId]: digest } } : s,
    ),

  finish: (leafId) =>
    set((s) => {
      if (!s.sessions[leafId]) return s;
      const next = { ...s.sessions };
      delete next[leafId];
      const digests = { ...s.digests };
      delete digests[leafId];
      return { sessions: next, digests };
    }),

  setLocalAgent: (state) =>
    set((s) => {
      const a = s.localAgent;
      if (a === state) return s;
      if (a && state && a.status === state.status && a.agent === state.agent) {
        return s;
      }
      return { localAgent: state };
    }),

  pushNotification: (n) =>
    set((s) => ({
      notifications: [
        { ...n, id: `n${++notifSeq}`, at: Date.now(), read: false },
        ...s.notifications,
      ].slice(0, MAX_NOTIFICATIONS),
    })),

  markAllRead: () =>
    set((s) => {
      if (!s.notifications.some((n) => !n.read)) return s;
      return { notifications: s.notifications.map((n) => ({ ...n, read: true })) };
    }),

  clearNotifications: () => set({ notifications: [] }),
}));
