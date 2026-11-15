import type { NativeBlockInput } from "@/modules/terminal/gl/nativeBlockInput";
export type NativeLeaf = {
  readonly submissionIdentity?: object;
  readonly blockInput?: NativeBlockInput | null;
  readonly id: number | null;
  readonly cwd: string | null;
  readonly shellReady: boolean;
  readonly commandRunning: boolean;
  readonly exited: boolean;
  readonly focused: boolean;
  readonly tuiReady: boolean;
  readonly alternateScreen: boolean;
  getSelection: () => string | null;
  navigateBlocks?: (direction: -1 | 1) => Promise<void>;
  clearBlockSelection?: () => boolean;
  clear?: (current?: () => boolean) => Promise<boolean>;
  write: (text: string) => boolean;
  writeOwned?: (text: string, current?: () => boolean) => Promise<void>;
  encodeShiftEnter?: () => Promise<string>;
  readText?: (maxLines?: number) => Promise<string | null>;
  paste: (text: string) => Promise<void>;
  submit: (
    text: string,
    current?: () => boolean,
    onWriteAttempt?: () => void,
  ) => Promise<void>;
  focus: () => void;
  repaint: () => void;
  dispose: () => Promise<void>;
  respawn: (cwd?: string) => Promise<void>;
};
const leaves = new Map<number, NativeLeaf>();
const listeners = new Map<number, Set<() => void>>();
export function subscribeNativeLeaf(
  leafId: number,
  listener: () => void,
): () => void {
  let set = listeners.get(leafId);
  if (!set) {
    set = new Set();
    listeners.set(leafId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(leafId) === set)
      listeners.delete(leafId);
  };
}
function notify(leafId: number): void {
  for (const listener of [...(listeners.get(leafId) ?? [])]) {
    try {
      listener();
    } catch {
      console.error("native terminal ownership observer failed");
    }
  }
}
export function getNativeLeaf(leafId: number): NativeLeaf | undefined {
  return leaves.get(leafId);
}
export function registerNativeLeaf(
  leafId: number,
  leaf: NativeLeaf,
): () => void {
  if (leaves.has(leafId))
    throw new Error("native terminal leaf is already registered");
  leaves.set(leafId, leaf);
  notify(leafId);
  return () => {
    if (leaves.get(leafId) === leaf) {
      leaves.delete(leafId);
      notify(leafId);
    }
  };
}
export function takeNativeLeaf(leafId: number): NativeLeaf | undefined {
  const leaf = leaves.get(leafId);
  leaves.delete(leafId);
  if (leaf) notify(leafId);
  return leaf;
}
export function nativeLeafForPty(id: number): number | null {
  for (const [leafId, leaf] of leaves) if (leaf.id === id) return leafId;
  return null;
}
export function focusedNativeLeaf(): NativeLeaf | undefined {
  for (const leaf of leaves.values()) if (leaf.focused) return leaf;
  return undefined;
}
