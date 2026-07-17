import { invoke } from "@tauri-apps/api/core";

/** Open (or reuse + show) the detachable floating notes window. Never steals
 *  focus from the main window. */
export async function openNotesWindow(): Promise<void> {
  await invoke("open_notes_window");
}
