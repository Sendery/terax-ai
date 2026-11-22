import { IS_MAC } from "@/lib/platform";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  fullDiskAccessHintSeen,
  markFullDiskAccessHintSeen,
  readFullDiskAccess,
  shouldHintFullDiskAccess,
} from "./fullDiskAccess";

/** Late enough to stay out of the way of launch. */
const HINT_DELAY_MS = 6000;

/**
 * Points at the Full Disk Access card once, the first time Terax runs without
 * the grant. Shown or dismissed, it does not come back: the card stays in
 * Settings.
 */
export function useFullDiskAccessHint(openPermissions: () => void): void {
  const open = useRef(openPermissions);
  open.current = openPermissions;

  useEffect(() => {
    if (!IS_MAC || fullDiskAccessHintSeen(window.localStorage)) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void readFullDiskAccess().then((status) => {
        if (!alive || !shouldHintFullDiskAccess(status, false)) return;
        markFullDiskAccessHintSeen(window.localStorage);
        toast.message("Stop the repeated macOS permission prompts", {
          description:
            "Give Terax Full Disk Access once and every shell and agent inside it inherits it.",
          duration: Number.POSITIVE_INFINITY,
          closeButton: true,
          action: { label: "Show me", onClick: () => open.current() },
        });
      });
    }, HINT_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
}
