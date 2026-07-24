import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { extensionInstallSnippet } from "./lib/releases";
import { useUpdater } from "./useUpdater";

type DistroKey = "arch" | "debian" | "fedora";

function distroCommand(key: DistroKey, version: string): string {
  switch (key) {
    case "arch":
      return "yay -S terax-bin";
    case "debian":
      return `sudo apt install ./Terax_${version}_amd64.deb`;
    case "fedora":
      return `sudo dnf install ./Terax-${version}-1.x86_64.rpm`;
  }
}

const DISTROS: { key: DistroKey; label: string }[] = [
  { key: "arch", label: "Arch" },
  { key: "debian", label: "Debian / Ubuntu" },
  { key: "fedora", label: "Fedora / RHEL" },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdaterDialog() {
  const { status, install, downloadManual, downloadExtension, dismiss } =
    useUpdater();
  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [extPhase, setExtPhase] = useState<"idle" | "downloading" | "done">(
    "idle",
  );
  const [distro, setDistro] = useState<DistroKey>("arch");
  const manual =
    status.kind === "manual-available" ||
    status.kind === "manual-downloading" ||
    status.kind === "manual-done"
      ? status.info
      : null;
  const manualVersion = manual?.version ?? "";
  const activeCommand = distroCommand(distro, manualVersion);

  const open =
    status.kind === "available" ||
    status.kind === "manual-available" ||
    status.kind === "manual-downloading" ||
    status.kind === "manual-done" ||
    status.kind === "downloading" ||
    status.kind === "ready";

  if (!open) return null;

  const update = status.kind === "available" ? status.update : null;
  const manualDownloading = status.kind === "manual-downloading";
  const manualDone = status.kind === "manual-done";
  const manualLinux = manual?.os === "linux";
  const hasAsset = manual?.asset != null;
  const revealTarget = manual?.os === "macos" ? "Finder" : "your file manager";
  const downloading = status.kind === "downloading";
  const ready = status.kind === "ready";

  const extension =
    status.kind === "available"
      ? status.extension
      : manual?.extensionAsset
        ? { asset: manual.extensionAsset, os: manual.os, version: manual.version }
        : null;
  const extensionSnippet = extension
    ? extensionInstallSnippet(extension.os, extension.asset.url)
    : "";

  const handleDownloadExtension = async () => {
    if (!extension) return;
    setExtPhase("downloading");
    try {
      await downloadExtension(extension.asset.url);
      setExtPhase("done");
    } catch {
      setExtPhase("idle");
    }
  };

  const copySnippet = async () => {
    if (!navigator?.clipboard?.writeText || !extension) return;
    try {
      await navigator.clipboard.writeText(extensionSnippet);
      setSnippetCopied(true);
      setTimeout(() => setSnippetCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const copyCommand = async () => {
    if (!navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(activeCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  const progress =
    downloading && status.contentLength
      ? Math.min(100, (status.downloaded / status.contentLength) * 100)
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (
          !o &&
          (status.kind === "available" ||
            status.kind === "manual-available" ||
            status.kind === "manual-done")
        )
          dismiss();
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            {ready
              ? "Update ready"
              : downloading
                ? "Downloading update…"
                : manualDone
                  ? "Installer downloaded"
                  : manual
                    ? `Terax v${manual.version} is available`
                    : `Terax v${update?.version} is available`}
          </DialogTitle>
          <DialogDescription>
            {ready
              ? "Restart Terax to finish installing."
              : downloading
                ? progress !== null
                  ? `${progress.toFixed(0)}% — ${formatBytes(status.downloaded)}`
                  : formatBytes(status.downloaded)
                : manualDone
                  ? `Saved to your downloads and revealed in ${revealTarget}. Open it to finish updating.`
                  : manualLinux
                    ? `You're on v${manual?.currentVersion}. Dev builds install manually — pick your distro and run the command, or grab the package from GitHub.`
                    : manual
                      ? hasAsset
                        ? `You're on v${manual.currentVersion}. Dev builds install manually — download the installer for this machine and open it to update.`
                        : `You're on v${manual.currentVersion}. Download the right package from GitHub and install it manually.`
                      : update?.body || "A new version is ready to install."}
          </DialogDescription>
        </DialogHeader>

        {downloading && progress !== null && (
          <Progress value={progress} className="mt-2" />
        )}
        {downloading && progress === null && (
          <Progress value={undefined} className="mt-2 animate-pulse" />
        )}
        {manualDownloading && (
          <Progress value={undefined} className="mt-2 animate-pulse" />
        )}

        {manualLinux && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex gap-1 rounded-md bg-muted/40 p-1">
              {DISTROS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setDistro(d.key)}
                  className={`flex-1 rounded px-2 py-1 text-[11px] transition-colors ${
                    distro === d.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-[12px]">
              <span className="flex-1 select-all">$ {activeCommand}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => void copyCommand()}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}

        {extension && (
          <div
            className="mt-3 flex min-w-0 flex-col gap-2 border-t border-border/60 pt-3"
            data-capture-target="updater-extension"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-[13px] font-medium">
                  Pi extension v{extension.version}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Companion extension for Pi — install separately from Terax.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void handleDownloadExtension()}
                disabled={extPhase === "downloading"}
                aria-label={`Download the Pi extension version ${extension.version}`}
              >
                {extPhase === "downloading"
                  ? "Downloading…"
                  : extPhase === "done"
                    ? "Downloaded"
                    : "Download extension"}
              </Button>
            </div>
            <div className="flex min-w-0 items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
              <pre className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed">
                {extensionSnippet}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => void copySnippet()}
                aria-label="Copy the Pi extension install commands"
              >
                {snippetCopied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          {status.kind === "available" && (
            <>
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Later
              </Button>
              <Button size="sm" onClick={() => void install()}>
                Install &amp; restart
              </Button>
            </>
          )}
          {(status.kind === "manual-available" ||
            status.kind === "manual-downloading") && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={dismiss}
                disabled={manualDownloading}
              >
                Later
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openUrl(status.info.releaseUrl)}
              >
                View on GitHub
              </Button>
              <Button
                size="sm"
                onClick={() => void downloadManual()}
                disabled={manualDownloading}
              >
                {manualDownloading
                  ? "Downloading…"
                  : hasAsset
                    ? "Download & reveal"
                    : "Open GitHub"}
              </Button>
            </>
          )}
          {manualDone && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openUrl(status.info.releaseUrl)}
              >
                View on GitHub
              </Button>
              <Button size="sm" onClick={dismiss}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
