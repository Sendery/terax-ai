import { cn } from "@/lib/utils";
import { createContext, type ReactNode, useContext, useEffect, useRef } from "react";
import { type LinkedTabs, linkedSide } from "./lib/linkedTabs";

export const LinkedTabContext = createContext<{
  link: LinkedTabs | undefined;
  activate: (tabId: number) => void;
} | null>(null);

export function useLinkedTabs() {
  return useContext(LinkedTabContext);
}

export function LinkedTabPane({ tabId, active, children, activateOnInteraction = true }: {
  tabId: number;
  active: boolean;
  children: ReactNode;
  activateOnInteraction?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const layout = useLinkedTabs();
  const side = linkedSide(layout?.link, tabId);
  const visible = active || side !== undefined;
  const activate = side && !active && activateOnInteraction ? layout?.activate : undefined;
  useEffect(() => {
    if (!activate) return;
    // Pointer and focus events inside cross-origin previews stop at the frame.
    let frame = 0;
    const focusFrame = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLIFrameElement && root.current?.contains(focused))
          activate(tabId);
      });
    };
    window.addEventListener("blur", focusFrame);
    return () => {
      window.removeEventListener("blur", focusFrame);
      cancelAnimationFrame(frame);
    };
  }, [activate, tabId]);
  return (
    <div
      ref={root}
      data-capture-target="pane"
      data-capture-tab-id={tabId}
      data-linked-tab-side={side}
      className={cn(
        "absolute inset-0",
        visible ? "pointer-events-auto" : "invisible pointer-events-none",
      )}
      style={side === "left" ? { right: "calc(100% - var(--tab-split-position) + 4px)" }
        : side === "right" ? { left: "calc(var(--tab-split-position) + 4px)" } : undefined}
      aria-hidden={!visible}
      onPointerDownCapture={activate ? () => activate(tabId) : undefined}
      onFocusCapture={activate ? () => activate(tabId) : undefined}
    >
      {children}
    </div>
  );
}
