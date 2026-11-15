import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { useTerminalDropStore } from "@/modules/terminal/lib/dropStore";
import { formatDroppedPaths } from "@/modules/terminal/lib/quoteShellPath";
import { pasteIntoLeaf } from "@/modules/terminal/lib/rendererPool";

// Tauri positions are physical pixels; DOM hit testing uses CSS pixels.
function leafIdAt(x: number, y: number): number | null {
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(x / dpr, y / dpr);
  const leafEl = el?.closest<HTMLElement>("[data-pane-leaf]");
  if (!leafEl) return null;
  const id = Number(leafEl.dataset.paneLeaf);
  return Number.isFinite(id) ? id : null;
}

/** Wires native OS file drops into the terminal pane under the cursor: shows a
 * drop overlay on that pane while dragging, and bracketed-pastes the
 * shell-quoted path(s) on drop. Drops outside any terminal leaf are ignored. */
export function useTerminalFileDrop(): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const setTarget = useTerminalDropStore.getState().setTarget;

    void getCurrentWebview()
      .onDragDropEvent((e) => {
        if (disposed) return;
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") {
          setTarget(leafIdAt(p.position.x, p.position.y));
          return;
        }
        if (p.type === "leave") {
          setTarget(null);
          return;
        }
        if (p.type === "drop") {
          setTarget(null);
          if (!p.paths.length) return;
          const leafId = leafIdAt(p.position.x, p.position.y);
          if (leafId !== null) {
            pasteIntoLeaf(leafId, formatDroppedPaths(p.paths));
          }
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err) => console.error("[terax] drag-drop listen failed:", err));

    return () => {
      disposed = true;
      setTarget(null);
      unlisten?.();
    };
  }, []);
}
