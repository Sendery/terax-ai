import { invoke } from "@tauri-apps/api/core";

export const WAKER_DEFAULT_INTERVAL_MINUTES = 15;
export const WAKER_MIN_INTERVAL_MINUTES = 1;
export const WAKER_MAX_INTERVAL_MINUTES = 180;

export type WakerStatus = {
  installed: boolean;
  intervalMinutes: number;
  /** True only where an unprivileged user task can wake a sleeping machine. */
  canWakeSystem: boolean;
  supported: boolean;
  path: string | null;
};

export const WAKER_UNAVAILABLE: WakerStatus = {
  installed: false,
  intervalMinutes: WAKER_DEFAULT_INTERVAL_MINUTES,
  canWakeSystem: false,
  supported: false,
  path: null,
};

export function clampWakerInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return WAKER_DEFAULT_INTERVAL_MINUTES;
  return Math.min(
    WAKER_MAX_INTERVAL_MINUTES,
    Math.max(WAKER_MIN_INTERVAL_MINUTES, Math.round(minutes)),
  );
}

/**
 * Explains what the waker can and cannot do on this platform, so the UI never
 * implies that a sleeping machine will be woken where that needs privileges.
 */
export function wakerCapabilityNote(status: WakerStatus): string {
  if (!status.supported) {
    return "Not available on this platform.";
  }
  if (status.canWakeSystem) {
    return "Can wake the computer from sleep to run a due task.";
  }
  return "Cannot wake the computer: a due task runs the next time it wakes, and your recovery policy decides what happens to anything missed.";
}

export async function readWakerStatus(): Promise<WakerStatus> {
  try {
    return await invoke<WakerStatus>("waker_status");
  } catch {
    return WAKER_UNAVAILABLE;
  }
}

export function installWaker(intervalMinutes: number): Promise<WakerStatus> {
  return invoke<WakerStatus>("waker_install", {
    intervalMinutes: clampWakerInterval(intervalMinutes),
  });
}

export function uninstallWaker(): Promise<WakerStatus> {
  return invoke<WakerStatus>("waker_uninstall");
}

/** Exports the earliest pending instant for a `--wake` process to read. */
export function writeWakeState(nextRunAt: number | null): Promise<void> {
  return invoke<void>("waker_write_state", { nextRunAt });
}
