import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { NotesPanel } from "@/modules/notes";
import {
  isNotesSyncPayload,
  NOTES_ACTION_EVENT,
  NOTES_CLOSED_EVENT,
  NOTES_READY_EVENT,
  NOTES_SYNC_EVENT,
  type NotesSyncPayload,
} from "@/modules/notes/lib/windowBridge";

const EMPTY: NotesSyncPayload = { tabId: null, tabTitle: null, notes: [] };

/** Root of the detached floating notes window. Mirrors the active tab's notes
 *  received over the bridge and forwards mutations back to the main window. */
export function NotesWindowApp() {
  const [state, setState] = useState<NotesSyncPayload>(EMPTY);

  useEffect(() => {
    const unSync = listen(NOTES_SYNC_EVENT, (e) => {
      if (isNotesSyncPayload(e.payload)) setState(e.payload);
    });
    const win = getCurrentWindow();
    const unClose = win.onCloseRequested(() => {
      void emit(NOTES_CLOSED_EVENT);
    });
    // Ask the main window to push the current state now that we're mounted.
    void emit(NOTES_READY_EVENT);
    return () => {
      void unSync.then((f) => f());
      void unClose.then((f) => f());
    };
  }, []);

  const dock = useCallback(() => {
    void emit(NOTES_CLOSED_EVENT);
    void getCurrentWindow().close();
  }, []);

  const addFromInput = useCallback((raw: string) => {
    void emit(NOTES_ACTION_EVENT, { type: "add-input", raw });
  }, []);
  const remove = useCallback((id: string) => {
    void emit(NOTES_ACTION_EVENT, { type: "remove", id });
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-card text-foreground">
      <div data-tauri-drag-region className="h-7 shrink-0" />
      <div className="min-h-0 flex-1">
        <NotesPanel
          notes={state.notes}
          disabled={state.tabId == null}
          subtitle={state.tabTitle}
          hideTitle="Dock back into panel"
          onAddFromInput={addFromInput}
          onRemove={remove}
          onHide={dock}
        />
      </div>
    </div>
  );
}
