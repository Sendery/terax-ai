import { useSyncExternalStore } from "react";
import { type SttSpeed, sttSpeedOf, subscribeSttSpeed } from "./client";
import type { SttLocalModel } from "./settings";

/** What this machine measured for a model, live as dictations complete. */
export function useSttSpeed(model: SttLocalModel): SttSpeed | null {
  return useSyncExternalStore(
    subscribeSttSpeed,
    () => sttSpeedOf(model),
    () => null,
  );
}
