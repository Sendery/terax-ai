import { invoke } from "@tauri-apps/api/core";

/**
 * macOS asks per protected folder, and attributes what a shell or an agent
 * does to the app that started it. Full Disk Access settles all of those with
 * one grant, and only the user can give it, in System Settings.
 */
export type FullDiskAccess =
  | "granted"
  | "denied"
  | "unknown"
  | "not-applicable";

export const FULL_DISK_ACCESS_HINT_KEY = "terax:full-disk-access-hint-seen";

export async function readFullDiskAccess(): Promise<FullDiskAccess> {
  try {
    return await invoke<FullDiskAccess>("privacy_full_disk_access");
  } catch {
    return "unknown";
  }
}

export function openFullDiskAccessSettings(): Promise<void> {
  return invoke<void>("privacy_open_full_disk_access");
}

/** Only a probe that was refused is worth interrupting for, and only once. */
export function shouldHintFullDiskAccess(
  status: FullDiskAccess,
  seen: boolean,
): boolean {
  return status === "denied" && !seen;
}

type HintStorage = Pick<Storage, "getItem" | "setItem">;

export function fullDiskAccessHintSeen(storage: HintStorage): boolean {
  try {
    return storage.getItem(FULL_DISK_ACCESS_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markFullDiskAccessHintSeen(storage: HintStorage): void {
  try {
    storage.setItem(FULL_DISK_ACCESS_HINT_KEY, "1");
  } catch {
    // Storage is unavailable: the hint shows again next launch.
  }
}

export type FullDiskAccessCopy = {
  title: string;
  body: string;
};

/**
 * A sandbox is another app to macOS, with its own bundle identifier, so the
 * installed app's grant does not reach it and it needs its own, once.
 */
export function fullDiskAccessCopy(sandbox: boolean): FullDiskAccessCopy {
  const app = sandbox ? "this sandbox" : "Terax";
  const scope =
    "macOS asks separately for Documents, Desktop, Downloads, external and network volumes and other apps' data, and every shell and agent running inside Terax counts as Terax. Full Disk Access covers all of them with one grant that they all inherit.";
  const separate = sandbox
    ? " A sandbox build is a separate app to macOS, so it needs its own grant once; it then holds for every later sandbox build."
    : " The grant survives updates. A sandbox build is a separate app and needs its own, once.";
  return {
    title: `Give ${app} Full Disk Access once`,
    body: scope + separate,
  };
}
