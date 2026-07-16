import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deriveSlotHealth,
  matchSlotForCwd,
  parseSlotMonitOutput,
  type SlotHealth,
  type SlotInfo,
  type SlotMatch,
} from "./slots";

type SlotMonitQueryResult = { available: boolean; raw: string };

export type SlotMonitorState = {
  /** null while the first availability probe is in flight. */
  available: boolean | null;
  slots: SlotInfo[];
  match: SlotMatch | null;
  health: SlotHealth | null;
  loading: boolean;
  refresh: () => void;
};

/**
 * Probes the user's `slot-monit` helper and tracks the slot (if any) that
 * contains `cwd`. The helper is absent on most machines, so the first probe
 * that reports it missing permanently disables further calls; the feature then
 * costs nothing. A present helper is re-queried on cwd change (debounced) and
 * on demand via `refresh` (used when the tooltip opens).
 */
export function useSlotMonitor(
  cwd: string | null | undefined,
): SlotMonitorState {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const disabledRef = useRef(false);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const initRef = useRef(false);

  const fetchSlots = useCallback(async () => {
    if (disabledRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const res = await invoke<SlotMonitQueryResult>("slot_monit_query");
      if (!mountedRef.current) return;
      if (!res.available) {
        disabledRef.current = true;
        setAvailable(false);
        setSlots([]);
        return;
      }
      setAvailable(true);
      setSlots(parseSlotMonitOutput(res.raw));
    } catch {
      // Transient failure: keep the last known state, do not disable.
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // cwd is a trigger, not a body dependency: the effect refetches slot state
  // whenever the active shell moves to a new directory.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cwd intentionally re-runs the probe on directory change.
  useEffect(() => {
    if (disabledRef.current) return;
    if (!initRef.current) {
      initRef.current = true;
      void fetchSlots();
      return;
    }
    const timer = setTimeout(() => void fetchSlots(), 500);
    return () => clearTimeout(timer);
  }, [cwd, fetchSlots]);

  const match = useMemo(() => matchSlotForCwd(slots, cwd), [slots, cwd]);
  const health = useMemo(
    () => (match ? deriveSlotHealth(match.slot) : null),
    [match],
  );

  const refresh = useCallback(() => void fetchSlots(), [fetchSlots]);

  return { available, slots, match, health, loading, refresh };
}
