import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { arch, platform } from "@tauri-apps/plugin-os";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useState } from "react";
import { BUILD_INFO } from "@/lib/buildInfo";
import { IS_LINUX } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  isNewerVersion,
  pickLatestRelease,
  releasesApiUrl,
  selectExtensionAsset,
  selectPlatformAsset,
  type ArchKind,
  type GithubRelease,
  type OsKind,
  type PlatformAsset,
  type UpdateChannel,
} from "./lib/releases";

const LAST_CHECK_KEY = "terax:updater:last-check";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface ManualUpdateInfo {
  version: string;
  currentVersion: string;
  body: string;
  releaseUrl: string;
  /** Running OS, or null when it cannot be determined. */
  os: OsKind | null;
  /** Best installer for the running OS/arch, or null when none matches. */
  asset: PlatformAsset | null;
  /** Companion Pi extension tarball on the same release, if published. */
  extensionAsset: PlatformAsset | null;
}

/** Companion Pi extension download surfaced alongside an app update. */
export interface ExtensionInfo {
  asset: PlatformAsset;
  os: OsKind | null;
  version: string;
}

// Identify the running desktop target so we can pick the right installer.
function currentTarget(): { os: OsKind | null; arch: ArchKind } {
  let os: OsKind | null = null;
  let cpu: ArchKind = "x86_64";
  try {
    const p = platform();
    if (p === "macos" || p === "windows" || p === "linux") os = p;
    cpu = arch() === "aarch64" ? "aarch64" : "x86_64";
  } catch {
    // Non-Tauri environment (e.g. tests) — leave defaults.
  }
  return { os, arch: cpu };
}

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; update: Update; extension: ExtensionInfo | null }
  | { kind: "manual-available"; info: ManualUpdateInfo }
  | { kind: "manual-downloading"; info: ManualUpdateInfo }
  | { kind: "manual-done"; info: ManualUpdateInfo; path: string }
  | { kind: "downloading"; downloaded: number; contentLength: number | null }
  | { kind: "ready" }
  | { kind: "error"; message: string };

// Discover the newest published release for a channel from the project's own
// GitHub repository (derived from the build, never a foreign remote). Used for
// every dev-channel check and for all Linux checks, which install manually.
async function checkReleaseViaApi(
  channel: UpdateChannel,
): Promise<ManualUpdateInfo | null> {
  const [current, res] = await Promise.all([
    getVersion(),
    fetch(releasesApiUrl(BUILD_INFO.repository), {
      headers: { Accept: "application/vnd.github+json" },
    }),
  ]);
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  const releases = Array.isArray(data) ? (data as GithubRelease[]) : [];
  const latest = pickLatestRelease(releases, channel);
  if (!latest) return null;
  const remote = latest.tag_name.replace(/^v/, "");
  if (!isNewerVersion(remote, current)) return null;
  const target = currentTarget();
  return {
    version: remote,
    currentVersion: current,
    body: latest.body ?? "",
    releaseUrl: latest.html_url,
    os: target.os,
    asset: target.os
      ? selectPlatformAsset(latest.assets, target.os, target.arch)
      : null,
    extensionAsset: selectExtensionAsset(latest.assets),
  };
}

// Resolve the companion extension download for a channel's latest release,
// independent of the app installer path. Used by the stable auto-update flow
// (which learns of updates through the Tauri endpoint, not the GitHub API) and
// by the About panel to show the version actually available for the channel.
export async function resolveExtensionInfo(
  channel: UpdateChannel,
): Promise<ExtensionInfo | null> {
  try {
    const res = await fetch(releasesApiUrl(BUILD_INFO.repository), {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    const releases = Array.isArray(data) ? (data as GithubRelease[]) : [];
    const latest = pickLatestRelease(releases, channel);
    if (!latest) return null;
    const asset = selectExtensionAsset(latest.assets);
    if (!asset) return null;
    return {
      asset,
      os: currentTarget().os,
      version: latest.tag_name.replace(/^v/, ""),
    };
  } catch {
    return null;
  }
}

interface Options {
  /** Skip the time-based throttle on automatic startup checks. */
  manual?: boolean;
}

interface HookOptions {
  /** When false, the hook does not run an automatic check on mount. */
  autoCheck?: boolean;
}

export function useUpdater({ autoCheck = true }: HookOptions = {}) {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });
  const channel = usePreferencesStore((s) => s.updateChannel);
  const hydrated = usePreferencesStore((s) => s.hydrated);

  const runCheck = useCallback(
    async ({ manual }: Options = {}) => {
      if (!manual) {
        const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
        if (Date.now() - last < CHECK_INTERVAL_MS) return;
      }
      setStatus({ kind: "checking" });
      try {
        // The Tauri auto-updater endpoint only serves the latest stable
        // release. The dev channel, and every Linux build, resolve through the
        // GitHub releases API and install manually.
        if (channel === "dev" || IS_LINUX) {
          const info = await checkReleaseViaApi(channel);
          if (info) {
            setStatus({ kind: "manual-available", info });
          } else {
            localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
            setStatus({ kind: "uptodate" });
          }
          return;
        }
        const update = await check();
        if (update) {
          const extension = await resolveExtensionInfo(channel);
          setStatus({ kind: "available", update, extension });
        } else {
          localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
          setStatus({ kind: "uptodate" });
        }
      } catch (err) {
        setStatus({ kind: "error", message: String(err) });
      }
    },
    [channel],
  );

  const install = useCallback(async () => {
    if (status.kind !== "available") return;
    const { update } = status;
    let total: number | null = null;
    let downloaded = 0;
    setStatus({ kind: "downloading", downloaded: 0, contentLength: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setStatus({
            kind: "downloading",
            downloaded: 0,
            contentLength: total,
          });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setStatus({ kind: "downloading", downloaded, contentLength: total });
        } else if (event.event === "Finished") {
          setStatus({ kind: "ready" });
        }
      });
      await relaunch();
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, [status]);

  // Dev-channel and Linux updates install manually: download the matching
  // installer, then reveal it in the OS file manager (Finder on macOS).
  const downloadManual = useCallback(async () => {
    if (status.kind !== "manual-available") return;
    const { info } = status;
    if (!info.asset) {
      await openUrl(info.releaseUrl);
      return;
    }
    setStatus({ kind: "manual-downloading", info });
    try {
      const path = await invoke<string>("download_release_asset", {
        url: info.asset.url,
      });
      await revealItemInDir(path);
      setStatus({ kind: "manual-done", info, path });
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, [status]);

  // Download the companion Pi extension tarball and reveal it, independent of
  // the app installer. The caller owns any transient UI state.
  const downloadExtension = useCallback(
    async (url: string): Promise<string> => {
      const path = await invoke<string>("download_release_asset", { url });
      await revealItemInDir(path);
      return path;
    },
    [],
  );

  const dismiss = useCallback(() => {
    setStatus({ kind: "idle" });
  }, []);

  useEffect(() => {
    if (!autoCheck || !hydrated) return;
    void runCheck();
  }, [autoCheck, hydrated, runCheck]);

  return {
    status,
    check: runCheck,
    install,
    downloadManual,
    downloadExtension,
    dismiss,
  };
}
