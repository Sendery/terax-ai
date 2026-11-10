import { useEffect, useSyncExternalStore } from "react";

// The engine module loads only when the palette first opens, so the main
// window pays nothing at startup for a developer tool.
let available: boolean | null = null;
let probing = false;
const listeners = new Set<() => void>();

const engine = () => import("@/modules/terminal/gl/engineSession");

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function probe(): void {
  if (probing) return;
  probing = true;
  engine()
    .then((m) => m.engineAvailable())
    .catch(() => false)
    .then((value) => {
      available = value;
      for (const listener of listeners) listener();
    });
}

/** Whether this build has the terminal engine, checked once `active` is true. */
export function useTerminalLabAvailable(active: boolean): boolean {
  const value = useSyncExternalStore(subscribe, () => available === true);
  useEffect(() => {
    if (active) probe();
  }, [active]);
  return value;
}

export function openTerminalLab(): void {
  engine()
    .then((m) => m.openTerminalLabWindow())
    .catch((error) => console.error("open terminal lab failed:", error));
}
