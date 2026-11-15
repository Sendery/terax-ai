export type NativeLeaf = {
  readonly id: number | null;
  readonly cwd: string | null;
  readonly shellReady: boolean;
  readonly commandRunning: boolean;
  readonly exited: boolean;
  readonly focused: boolean;
  readonly tuiReady: boolean;
  readonly alternateScreen: boolean;
  getSelection: () => string | null;
  write: (text: string) => boolean;
  paste: (text: string) => Promise<void>;
  submit: (text: string) => Promise<void>;
  focus: () => void;
  repaint: () => void;
  dispose: () => Promise<void>;
  respawn: (cwd?: string) => Promise<void>;
};
const leaves = new Map<number, NativeLeaf>();
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
  return () => {
    if (leaves.get(leafId) === leaf) leaves.delete(leafId);
  };
}
export function takeNativeLeaf(leafId: number): NativeLeaf | undefined {
  const leaf = leaves.get(leafId);
  leaves.delete(leafId);
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
