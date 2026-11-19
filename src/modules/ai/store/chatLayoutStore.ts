import { useChatStore } from "./chatStore";
import { create } from "zustand";
import {
  BOTTOM_MAX_H,
  BOTTOM_MIN_H,
  DOCK_MAX_W,
  DOCK_MIN_W,
  parseChatLayout,
  type ChatLayout,
  type ChatLayoutMode,
} from "../lib/chatLayout";

const STORE_KEY = "terax-ui-chat-layout";

function load(): ChatLayout {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return parseChatLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return parseChatLayout(null);
  }
}

function save(layout: ChatLayout) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(layout));
  } catch {
    // private mode or quota: the layout just won't survive a restart
  }
}

type ChatLayoutState = ChatLayout & {
  setMode: (mode: ChatLayoutMode) => void;
  setDockWidth: (width: number) => void;
  setBottomHeight: (height: number) => void;
};

const pick = (s: ChatLayoutState): ChatLayout => ({
  mode: s.mode,
  dockWidth: s.dockWidth,
  bottomHeight: s.bottomHeight,
});

const clampTo = (v: number, lo: number, hi: number) =>
  Math.round(Math.min(hi, Math.max(lo, v)));

/** App-level, not per tab: where the Terax chat is presented and how big
 * its docked forms are. Persisted the same way as the floating geometry. */
export const useChatLayoutStore = create<ChatLayoutState>((set, get) => {
  const commit = (patch: Partial<ChatLayout>) => {
    const prev = pick(get());
    const next = { ...prev, ...patch };
    if (
      next.mode === prev.mode &&
      next.dockWidth === prev.dockWidth &&
      next.bottomHeight === prev.bottomHeight
    )
      return;
    set(patch);
    save(next);
  };
  return {
    ...load(),
    setMode: (mode) => commit({ mode }),
    setDockWidth: (width) =>
      commit({ dockWidth: clampTo(width, DOCK_MIN_W, DOCK_MAX_W) }),
    setBottomHeight: (height) =>
      commit({ bottomHeight: clampTo(height, BOTTOM_MIN_H, BOTTOM_MAX_H) }),
  };
});

export function switchChatLayout(mode: ChatLayoutMode) {
  useChatLayoutStore.getState().setMode(mode);
  // The bottom pane sits on the composer; without it the pane would float
  // over an empty strip.
  if (mode === "bottom") useChatStore.getState().openPanel();
}
