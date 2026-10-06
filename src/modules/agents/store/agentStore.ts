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

/** Deep equality for the plain JSON a digest arrives as. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => sameJson(left[key], right[key]));
}

/** The pane whose session is reading from `ptyId`, if any. */
export function leafOwningPty(
  sessions: Record<number, AgentSession>,
  ptyId: number,
): number | null {
  for (const session of Object.values(sessions)) {
    if (session.ptyId === ptyId) return session.leafId;
  }
  return null;
}

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
    ptyId?: number | null,
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
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
};

export const useAgentStore = create<AgentStoreState>((set) => ({
  sessions: {},
  digests: {},
  localAgent: null,
  notifications: [],

  start: (
    leafId,
    tabId,
    agent,
    integration = "pty-detection",
    harness = "generic",
    ptyId = null,
  ) =>
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
            ptyId,
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
    set((s) => {
      if (!s.sessions[leafId]) return s;
      // Most refreshes find nothing appended; keeping the old object spares
      // every digest subscriber a re-render for an identical value.
      if (sameJson(s.digests[leafId], digest)) return s;
      return { digests: { ...s.digests, [leafId]: digest } };
    }),

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

  markRead: (id) =>
    set((s) => {
      if (!s.notifications.some((n) => n.id === id && !n.read)) return s;
      return {
        notifications: s.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        ),
      };
    }),

  markAllRead: () =>
    set((s) => {
      if (!s.notifications.some((n) => !n.read)) return s;
      return { notifications: s.notifications.map((n) => ({ ...n, read: true })) };
    }),

  dismissNotification: (id) =>
    set((s) => {
      if (!s.notifications.some((n) => n.id === id)) return s;
      return { notifications: s.notifications.filter((n) => n.id !== id) };
    }),

  clearNotifications: () => set({ notifications: [] }),
}));
