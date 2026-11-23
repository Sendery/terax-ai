import { IS_MAC } from "@/lib/platform";
import { useCallback, useEffect, useState } from "react";
import { type FullDiskAccess, readFullDiskAccess } from "./fullDiskAccess";

/**
 * The current grant, re-read when the window regains focus: the user grants it
 * in System Settings and comes back.
 */
export function useFullDiskAccess(): {
  status: FullDiskAccess | null;
  refresh: () => void;
} {
  const [status, setStatus] = useState<FullDiskAccess | null>(
    IS_MAC ? null : "not-applicable",
  );

  const refresh = useCallback(() => {
    if (!IS_MAC) return;
    void readFullDiskAccess().then(setStatus);
  }, []);

  useEffect(() => {
    if (!IS_MAC) return;
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  return { status, refresh };
}
