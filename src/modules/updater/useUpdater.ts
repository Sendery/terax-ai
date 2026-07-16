import { getVersion } from "@tauri-apps/api/app";
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
  type GithubRelease,
  type UpdateChannel,
} from "./lib/releases";

const LAST_CHECK_KEY = "terax:updater:last-check";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface ManualUpdateInfo {
  version: string;
  currentVersion: string;
  body: string;
  releaseUrl: string;
}

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; update: Update }
  | { kind: "manual-available"; info: ManualUpdateInfo }
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
  return {
    version: remote,
    currentVersion: current,
    body: latest.body ?? "",
    releaseUrl: latest.html_url,
  };
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
          setStatus({ kind: "available", update });
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

  const dismiss = useCallback(() => {
    setStatus({ kind: "idle" });
  }, []);

  useEffect(() => {
    if (!autoCheck || !hydrated) return;
    void runCheck();
  }, [autoCheck, hydrated, runCheck]);

  return { status, check: runCheck, install, dismiss };
}
