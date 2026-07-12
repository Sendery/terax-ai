import { Button } from "@/components/ui/button";
import {
  BUILD_INFO,
  buildChannelLabel,
  buildCommitUrl,
  formatBuildDate,
  shortCommit,
} from "@/lib/buildInfo";
import { useUpdater } from "@/modules/updater";
import { GithubIcon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getName, getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { arch, platform } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const REPO_URL = `https://github.com/${BUILD_INFO.repository}`;
const ORGANIZATION_URL = "https://github.com/Sendery";
const COMMIT_URL = buildCommitUrl(BUILD_INFO.repository, BUILD_INFO.commit);
const CHANNEL_LABEL = buildChannelLabel(BUILD_INFO.channel);

const PLATFORM_LABEL: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
  freebsd: "FreeBSD",
};

export function AboutSection() {
  const [version, setVersion] = useState("");
  const [name, setName] = useState("Terax");
  const [build, setBuild] = useState("");
  const { status, check, install } = useUpdater({ autoCheck: false });
  const checking = status.kind === "checking";
  const downloading = status.kind === "downloading";
  const available = status.kind === "available";
  const manualAvailable = status.kind === "manual-available";
  const ready = status.kind === "ready";
  const checkLabel =
    status.kind === "uptodate"
      ? "You're up to date"
      : status.kind === "error"
        ? "Check failed — retry"
        : checking
          ? "Checking…"
          : downloading
            ? "Downloading…"
            : ready
              ? "Restart to install"
              : available
                ? `Install v${status.update.version}`
                : manualAvailable
                  ? `Update to v${status.info.version}`
                  : "Check for updates";
  const onUpdateClick = () => {
    if (available) void install();
    else void check({ manual: true });
  };

  useEffect(() => {
    void getVersion().then(setVersion);
    void getName().then(setName);
    try {
      const p = platform();
      const a = arch();
      const platformLabel = PLATFORM_LABEL[p] ?? p;
      setBuild(`${platformLabel} · ${a}`);
    } catch {
      setBuild("");
    }
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="About" description="" />

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/60 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <img src="/logo.png" alt="" className="size-12" draggable={false} />
          <div className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold tracking-tight">
              {name}
            </span>
            <span className="text-[11px] text-muted-foreground">
              Sendery · Open-source AI-native terminal emulator
            </span>
            <span className="mt-1 font-mono text-[11px] text-muted-foreground">
              v{version || "—"} · {BUILD_INFO.branch} ·{" "}
              {shortCommit(BUILD_INFO.commit)}
            </span>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wide ${
            BUILD_INFO.channel === "official"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
        >
          {CHANNEL_LABEL}
        </span>
      </div>

      <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-2.5 text-[12px]">
        <dt className="text-muted-foreground">Version</dt>
        <dd className="font-mono text-[11.5px]">v{version || "—"}</dd>

        <dt className="text-muted-foreground">Build</dt>
        <dd className="font-mono text-[11.5px]">{build || "Unknown"}</dd>

        <dt className="text-muted-foreground">Release channel</dt>
        <dd>{CHANNEL_LABEL}</dd>

        <dt className="text-muted-foreground">Source branch</dt>
        <dd className="break-all font-mono text-[11.5px]">
          {BUILD_INFO.branch}
        </dd>

        <dt className="text-muted-foreground">Source commit</dt>
        <dd>
          <button
            type="button"
            title={BUILD_INFO.commit}
            onClick={() => void openUrl(COMMIT_URL)}
            className="break-all font-mono text-[11.5px] underline-offset-2 hover:text-foreground hover:underline"
          >
            {shortCommit(BUILD_INFO.commit)}
          </button>
        </dd>

        <dt className="text-muted-foreground">Built at</dt>
        <dd className="font-mono text-[11.5px]" title={BUILD_INFO.builtAt}>
          {formatBuildDate(BUILD_INFO.builtAt)}
        </dd>

        <dt className="text-muted-foreground">Publisher</dt>
        <dd>Sendery</dd>

        <dt className="text-muted-foreground">Bundle ID</dt>
        <dd className="font-mono text-[11.5px]">app.crynta.terax</dd>

        <dt className="text-muted-foreground">License</dt>
        <dd>Apache 2.0</dd>

        <dt className="text-muted-foreground">Source code</dt>
        <dd>
          <button
            type="button"
            onClick={() => void openUrl(REPO_URL)}
            className="inline-flex items-center gap-1.5 rounded-md text-[12px] underline-offset-2 hover:text-foreground hover:underline"
          >
            <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={1.75} />
            {BUILD_INFO.repository}
          </button>
        </dd>

        <dt className="text-muted-foreground">Organization</dt>
        <dd>
          <button
            type="button"
            onClick={() => void openUrl(ORGANIZATION_URL)}
            className="inline-flex items-center gap-1.5 rounded-md text-[12px] underline-offset-2 hover:text-foreground hover:underline"
          >
            <HugeiconsIcon icon={Globe02Icon} size={12} strokeWidth={1.75} />
            Sendery
          </button>
        </dd>
      </dl>

      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={onUpdateClick}
            disabled={checking || downloading || ready}
          >
            {checkLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(REPO_URL)}
            className="gap-1.5"
          >
            <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={1.75} />
            View on GitHub
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void openUrl(`${REPO_URL}/issues/new`)}
          >
            Report an issue
          </Button>
        </div>
        {status.kind === "error" && (
          <p className="font-mono text-[10.5px] break-all text-destructive/80">
            {status.message}
          </p>
        )}
        {downloading && status.contentLength ? (
          <p className="text-[11px] text-muted-foreground">
            {Math.min(
              100,
              Math.round((status.downloaded / status.contentLength) * 100),
            )}
            %
          </p>
        ) : null}
      </div>
    </div>
  );
}
