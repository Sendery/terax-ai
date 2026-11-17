import { LazyStore } from "@tauri-apps/plugin-store";
import type { Watch } from "./watch";

const STORE_PATH = "terax-watches.json";
const KEY_LIST = "watches";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadWatches(): Promise<Watch[]> {
  return (await store.get<Watch[]>(KEY_LIST)) ?? [];
}

export async function saveWatches(list: Watch[]): Promise<void> {
  await store.set(KEY_LIST, list);
}
