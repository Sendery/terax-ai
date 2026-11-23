import { IS_MAC } from "@/lib/platform";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  fullDiskAccessHintSeen,
  markFullDiskAccessHintSeen,
  openFullDiskAccessSettings,
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
export function useFullDiskAccessHint(): void {
  useEffect(() => {
    if (!IS_MAC || fullDiskAccessHintSeen(window.localStorage)) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void readFullDiskAccess().then((status) => {
        if (!alive || !shouldHintFullDiskAccess(status, false)) return;
        markFullDiskAccessHintSeen(window.localStorage);
        toast.message("Stop the repeated macOS permission prompts", {
          description:
            "Shells and agents inherit this grant. Pi-Terax Sandbox needs its own grant.",
          duration: Number.POSITIVE_INFINITY,
          closeButton: true,
          action: {
            label: "Open System Settings",
            onClick: () => {
              void openFullDiskAccessSettings().catch(() =>
                toast.error("Could not open Full Disk Access settings."),
              );
            },
          },
        });
      });
    }, HINT_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
}
