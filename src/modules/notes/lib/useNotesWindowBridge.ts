import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { NoteCard } from "./cards";
import type { NoteCardPatch } from "./collection";
import {
  NOTES_ACTION_EVENT,
  NOTES_CLOSED_EVENT,
  NOTES_READY_EVENT,
  NOTES_SYNC_EVENT,
  type NotesSyncPayload,
  parseNotesAction,
} from "./windowBridge";

type BridgeApi = {
  addFromInput: (raw: string) => void;
  remove: (id: string) => void;
  update: (id: string, patch: NoteCardPatch) => void;
  move: (id: string, toIndex: number) => void;
};

/**
 * Main-window side of the detachable notes window. Applies mutation actions
 * from the window and pushes the active tab's notes to it. The main window is
 * the single source of truth and the only writer to the persisted store.
 */
export function useNotesWindowBridge(opts: {
  detached: boolean;
  activeTabId: number | null;
  activeTabTitle: string | null;
  notes: readonly NoteCard[];
  api: BridgeApi;
  onWindowClosed: () => void;
}): void {
  const { detached, activeTabId, activeTabTitle, notes } = opts;

  const payloadRef = useRef<NotesSyncPayload>({
    tabId: null,
    tabTitle: null,
    notes: [],
  });
  payloadRef.current = {
    tabId: activeTabId,
    tabTitle: activeTabTitle,
    notes: notes as NoteCard[],
  };

  const apiRef = useRef(opts.api);
  apiRef.current = opts.api;
  const onClosedRef = useRef(opts.onWindowClosed);
  onClosedRef.current = opts.onWindowClosed;

  // Apply inbound mutation actions (validated) to the active tab's notes.
  useEffect(() => {
    const un = listen(NOTES_ACTION_EVENT, (e) => {
      const action = parseNotesAction(e.payload);
      if (!action) return;
      const api = apiRef.current;
      switch (action.type) {
        case "add-input":
          api.addFromInput(action.raw);
          break;
        case "remove":
          api.remove(action.id);
          break;
        case "update":
          api.update(action.id, action.patch);
          break;
        case "move":
          api.move(action.id, action.toIndex);
          break;
      }
    });
    return () => void un.then((f) => f());
  }, []);

  // The window asks for current state when it mounts.
  useEffect(() => {
    const un = listen(NOTES_READY_EVENT, () => {
      void emit(NOTES_SYNC_EVENT, payloadRef.current);
    });
    return () => void un.then((f) => f());
  }, []);

  // The window closed (docked back or native close): re-attach the inline panel.
  useEffect(() => {
    const un = listen(NOTES_CLOSED_EVENT, () => onClosedRef.current());
    return () => void un.then((f) => f());
  }, []);

  // Push state to the window whenever it changes while detached.
  useEffect(() => {
    if (!detached) return;
    void emit(NOTES_SYNC_EVENT, payloadRef.current);
  }, [detached, activeTabId, activeTabTitle, notes]);
}
