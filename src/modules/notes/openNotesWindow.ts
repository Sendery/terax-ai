import { invoke } from "@tauri-apps/api/core";

/** Open (or reuse + show) the detachable floating notes window. Never steals
 *  focus from the main window. */
export async function openNotesWindow(): Promise<void> {
  await invoke("open_notes_window");
}

/** Close the floating notes window (no-op if it isn't open). */
export async function closeNotesWindow(): Promise<void> {
  await invoke("close_notes_window");
}
