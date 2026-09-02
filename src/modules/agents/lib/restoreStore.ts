import { LazyStore } from "@tauri-apps/plugin-store";
import {
  type AgentRestoreSnapshot,
  parseRestoreSnapshot,
  type SavedAgentSession,
} from "./restore";

/**
 * Which agent sessions were live the last time Terax was running.
 *
 * Kept out of `terax-spaces.json` on purpose: the space state describes tabs
 * and is rewritten on every tab change, while this is a short-lived record that
 * is consumed and cleared on the next launch. Writing it continuously rather
 * than at shutdown is what makes it survive a crash, an update, or a
 * reinstall - none of which get to run a close handler.
 */
const STORE_PATH = "terax-agent-restore.json";
const KEY_SNAPSHOT = "snapshot";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 500 });

export async function readRestoreSnapshot(): Promise<AgentRestoreSnapshot | null> {
  try {
    return parseRestoreSnapshot(await store.get(KEY_SNAPSHOT));
  } catch {
    return null;
  }
}

export async function writeRestoreSnapshot(
  snapshot: AgentRestoreSnapshot,
): Promise<void> {
  try {
    await store.set(KEY_SNAPSHOT, snapshot);
  } catch {
    // A snapshot that cannot be written is a lost convenience, never an error
    // the user has to deal with mid-session.
  }
}

export async function clearRestoreSnapshot(): Promise<void> {
  try {
    await store.delete(KEY_SNAPSHOT);
  } catch {
    /* ignore */
  }
}

export type { AgentRestoreSnapshot, SavedAgentSession };
