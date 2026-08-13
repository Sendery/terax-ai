import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

export const MAX_CAPTURE_WIDTH = 7_680;
export const MAX_CAPTURE_HEIGHT = 4_320;
export const MAX_CAPTURE_PIXELS = 16_777_216;
export const MAX_VIDEO_DURATION_SECONDS = 30;
export const MAX_VIDEO_FPS = 30;
export const MAX_VIDEO_FRAMES = 900;
export const MAX_TEMP_BYTES = 512 * 1024 * 1024;
export const MAX_BASELINE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_GUARD_INTERVAL_MS = 250;

export type VisualSurface = "main" | "settings";
export type VisualAction = "screenshot" | "video" | "compare";

export const NATIVE_CAPTURE_TARGETS = [
  "window",
  "header",
  "sidebar",
  "tabstrip",
  "statusbar",
  "active-pane",
  "pane",
  "overlay",
  "agent-monitor",
] as const;

export type NativeCaptureTarget = (typeof NATIVE_CAPTURE_TARGETS)[number];

export function isNativeCaptureTarget(
  value: unknown,
): value is NativeCaptureTarget {
  return (
    typeof value === "string" &&
    NATIVE_CAPTURE_TARGETS.includes(value as NativeCaptureTarget)
  );
}

export type WindowSelector = {
  pid: number;
  processName: "terax";
  title: string;
};

export type WindowDescriptor = {
  handle: string;
  pid: number;
  processName: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ArtifactPaths = {
  directory: string;
  mediaPath: string;
  previewPath: string;
  reportPath: string;
};

export function sanitizeArtifactName(value: string): string {
  if (value.includes("/") || value.includes("\\")) {
    throw new Error("Artifact name contains a path separator");
  }
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!normalized) {
    throw new Error("Artifact name must contain letters or numbers");
  }
  return normalized;
}

function timestampId(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(".000", "");
}

function pathsForDirectory(
  directory: string,
  action: VisualAction,
): ArtifactPaths {
  return {
    directory,
    mediaPath: resolve(
      directory,
      action === "video" ? "recording.mp4" : "screenshot.png",
    ),
    previewPath: resolve(directory, "preview.png"),
    reportPath: resolve(directory, "result.json"),
  };
}

export function buildArtifactPaths(
  projectRoot: string,
  action: VisualAction,
  name: string,
  now = new Date(),
): ArtifactPaths {
  const root = resolve(projectRoot);
  const directory = resolve(
    root,
    ".terax",
    "visual-qa",
    `${timestampId(now)}-${sanitizeArtifactName(name)}`,
  );
  if (!isInside(root, directory)) {
    throw new Error("Visual QA output escaped the trusted project");
  }
  return pathsForDirectory(directory, action);
}

export function surfaceSelector(
  surface: VisualSurface,
  pid: number,
): WindowSelector {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw new Error("Visual QA requires the authenticated Terax PID");
  }
  return {
    pid,
    processName: "terax",
    title: surface === "settings" ? "Settings" : "Terax",
  };
}

export function assertVisualCaptureSafe(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Invalid Terax snapshot for visual QA");
  }
  const record = snapshot as Record<string, unknown>;
  if (!Array.isArray(record.tabs)) {
    throw new Error("Invalid Terax snapshot for visual QA");
  }
  const active = record.tabs.find((tab) => {
    if (!tab || typeof tab !== "object") return false;
    return (tab as Record<string, unknown>).id === record.activeTabId;
  });
  if (
    active &&
    typeof active === "object" &&
    (active as Record<string, unknown>).kind === "private-terminal"
  ) {
    throw new Error("Visual QA refuses to capture an active private terminal");
  }
}

function assertCaptureDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_CAPTURE_WIDTH ||
    height > MAX_CAPTURE_HEIGHT ||
    width * height > MAX_CAPTURE_PIXELS
  ) {
    throw new Error("Window dimensions exceed visual capture limits");
  }
}

export function parseWindowDescriptor(stdout: string): WindowDescriptor {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    throw new Error("Invalid window descriptor");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Invalid window descriptor");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.handle !== "string" ||
    !/^0x[0-9a-f]+$/i.test(record.handle) ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) < 1 ||
    typeof record.processName !== "string" ||
    record.processName.length === 0 ||
    typeof record.title !== "string" ||
    typeof record.x !== "number" ||
    !Number.isFinite(record.x) ||
    typeof record.y !== "number" ||
    !Number.isFinite(record.y) ||
    typeof record.width !== "number" ||
    typeof record.height !== "number"
  ) {
    throw new Error("Invalid window descriptor");
  }
  assertCaptureDimensions(record.width, record.height);
  return {
    handle: record.handle,
    pid: record.pid as number,
    processName: record.processName,
    title: record.title,
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height,
  };
}

export function parseSsim(stderr: string): number {
  const match = stderr.match(/\bAll:([0-9]+(?:\.[0-9]+)?)/);
  if (!match) throw new Error("FFmpeg did not report SSIM");
  return Number(match[1]);
}

export function buildVideoArgs(
  framePattern: string,
  outputPath: string,
  fps: number,
): string[] {
  if (!Number.isInteger(fps) || fps < 1 || fps > MAX_VIDEO_FPS) {
    throw new Error("Video FPS must be an integer between 1 and 30");
  }
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-framerate",
    String(fps),
    "-i",
    framePattern,
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-y",
    outputPath,
  ];
}

export type VisualQaRequest = {
  action: VisualAction;
  surface: VisualSurface;
  name: string;
  target?: NativeCaptureTarget;
  tabId?: number;
  durationSeconds?: number;
  fps?: number;
  baselinePath?: string;
  threshold?: number;
};

export type VisualBackend = {
  capture: (
    selector: WindowSelector,
    outputPath: string,
    signal?: AbortSignal,
  ) => Promise<WindowDescriptor>;
  record: (
    selector: WindowSelector,
    outputPath: string,
    durationSeconds: number,
    fps: number,
    signal?: AbortSignal,
  ) => Promise<WindowDescriptor>;
  compare: (
    currentPath: string,
    baselinePath: string,
    signal?: AbortSignal,
  ) => Promise<number>;
};

export type VisualQaResult = {
  action: VisualAction;
  surface: VisualSurface;
  captureSucceeded: true;
  baselinePassed?: boolean;
  mediaPath: string;
  imagePath: string;
  reportPath: string;
  window: WindowDescriptor;
  previewWindow?: WindowDescriptor;
  score?: number;
  threshold?: number;
  baselinePath?: string;
};

export type ValidatedVisualQaRequest = {
  action: VisualAction;
  surface: VisualSurface;
  name: string;
  target?: NativeCaptureTarget;
  tabId?: number;
  durationSeconds: number;
  fps: number;
  threshold?: number;
  baselinePath?: string;
};

export function validateVisualQaRequest(
  request: VisualQaRequest,
): ValidatedVisualQaRequest {
  if (!["screenshot", "video", "compare"].includes(request.action)) {
    throw new Error("Invalid visual QA action");
  }
  if (!["main", "settings"].includes(request.surface)) {
    throw new Error("Invalid visual QA surface");
  }
  const name = sanitizeArtifactName(request.name);
  const durationSeconds = request.durationSeconds ?? 5;
  const fps = request.fps ?? 15;
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > MAX_VIDEO_DURATION_SECONDS
  ) {
    throw new Error("Video duration must be between 1 and 30 seconds");
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > MAX_VIDEO_FPS) {
    throw new Error("Video FPS must be an integer between 1 and 30");
  }
  if (Math.ceil(durationSeconds * fps) > MAX_VIDEO_FRAMES) {
    throw new Error(`Video exceeds the ${MAX_VIDEO_FRAMES} frame limit`);
  }
  if (request.target !== undefined) {
    if (!isNativeCaptureTarget(request.target)) {
      throw new Error("Invalid native capture target");
    }
    if (request.surface !== "main") {
      throw new Error("Native capture targets require the main surface");
    }
    if (request.target === "pane" && !Number.isInteger(request.tabId)) {
      throw new Error("Native pane capture requires an integer tabId");
    }
    if (request.target !== "pane" && request.tabId !== undefined) {
      throw new Error("tabId is only accepted for pane captures");
    }
  } else if (request.tabId !== undefined) {
    throw new Error("tabId requires a native capture target");
  }
  if (request.action === "compare" && !request.baselinePath) {
    throw new Error("baselinePath is required for visual comparison");
  }
  if (request.baselinePath !== undefined && request.baselinePath.length === 0) {
    throw new Error("baselinePath must not be empty");
  }
  const threshold = request.threshold ?? (request.action === "compare" ? 0.99 : undefined);
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
    throw new Error("Visual comparison threshold must be between 0 and 1");
  }
  return {
    action: request.action,
    surface: request.surface,
    name,
    ...(request.target === undefined ? {} : { target: request.target }),
    ...(request.tabId === undefined ? {} : { tabId: request.tabId }),
    durationSeconds,
    fps,
    threshold,
    baselinePath: request.baselinePath,
  };
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

type FileIdentity = {
  path: string;
  dev: bigint;
  ino: bigint;
  size: number;
};

type DirectoryIdentity = {
  path: string;
  dev: bigint;
  ino: bigint;
};

function sameIdentity(
  actual: { dev: bigint; ino: bigint },
  expected: { dev: bigint; ino: bigint },
): boolean {
  return actual.dev === expected.dev && actual.ino === expected.ino;
}

async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  const info = await lstat(path, { bigint: true });
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Visual QA directory identity is invalid");
  }
  if ((await realpath(path)) !== path) {
    throw new Error("Visual QA directory is no longer canonical");
  }
  return { path, dev: info.dev, ino: info.ino };
}

async function assertDirectoryIdentity(expected: DirectoryIdentity): Promise<void> {
  try {
    const actual = await directoryIdentity(expected.path);
    if (!sameIdentity(actual, expected)) {
      throw new Error("identity mismatch");
    }
  } catch (error) {
    throw new Error("Visual QA directory or ancestor was replaced", { cause: error });
  }
}

async function resolveBaseline(
  canonicalRoot: string,
  requestedPath: string,
): Promise<FileIdentity> {
  const lexical = resolve(canonicalRoot, requestedPath);
  if (!isInside(canonicalRoot, lexical)) {
    throw new Error("Baseline must be inside the trusted project");
  }
  try {
    const lexicalStats = await lstat(lexical, { bigint: true });
    if (lexicalStats.isSymbolicLink()) {
      throw new Error("Baseline must be a regular file inside the trusted project");
    }
    const canonical = await realpath(lexical);
    const canonicalStats = await stat(canonical, { bigint: true });
    if (!isInside(canonicalRoot, canonical) || !canonicalStats.isFile()) {
      throw new Error("Baseline must be a regular file inside the trusted project");
    }
    if (canonicalStats.size > BigInt(MAX_BASELINE_BYTES)) {
      throw new Error(`Baseline exceeds the ${MAX_BASELINE_BYTES} byte limit`);
    }
    return {
      path: canonical,
      dev: canonicalStats.dev,
      ino: canonicalStats.ino,
      size: Number(canonicalStats.size),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Baseline must") || error.message.startsWith("Baseline exceeds"))
    ) {
      throw error;
    }
    throw new Error("Baseline must be a regular file inside the trusted project", {
      cause: error,
    });
  }
}

async function snapshotBaseline(
  baseline: FileIdentity,
  destination: string,
  beforeOpen?: () => Promise<void> | void,
): Promise<void> {
  await beforeOpen?.();
  const source = await open(
    baseline.path,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  let target: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const opened = await source.stat({ bigint: true });
    if (!opened.isFile() || !sameIdentity(opened, baseline) || Number(opened.size) !== baseline.size) {
      throw new Error("Baseline changed before it could be snapshotted");
    }
    target = await open(destination, "wx", 0o600);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_BASELINE_BYTES || total > baseline.size) {
        throw new Error(`Baseline exceeds the ${MAX_BASELINE_BYTES} byte limit`);
      }
      let offset = 0;
      while (offset < bytesRead) {
        const { bytesWritten } = await target.write(buffer, offset, bytesRead - offset);
        offset += bytesWritten;
      }
    }
    const after = await source.stat({ bigint: true });
    if (total !== baseline.size || !sameIdentity(after, baseline) || Number(after.size) !== baseline.size) {
      throw new Error("Baseline changed while it was being snapshotted");
    }
    await target.sync();
  } finally {
    await target?.close();
    await source.close();
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error("Visual QA evidence directory cannot be a symbolic link");
    }
    if (!info.isDirectory()) {
      throw new Error("Visual QA evidence path must be a directory");
    }
    await chmod(path, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { mode: 0o700 });
  }
}

const WINDOWS_PRIVATE_DIRECTORY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:TERAX_PRIVATE_DIRECTORY
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetOwner($identity.User)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
[System.IO.Directory]::SetAccessControl($path, $acl)
`;

async function applyNativeWindowsDirectoryProtection(path: string): Promise<void> {
  if (process.platform !== "win32") return;
  const encoded = Buffer.from(WINDOWS_PRIVATE_DIRECTORY_SCRIPT, "utf16le").toString("base64");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        env: { ...process.env, TERAX_PRIVATE_DIRECTORY: path },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(
        `Failed to protect visual QA evidence directory: ${Buffer.concat(errors).toString("utf8").trim()}`,
      ));
    });
  });
}

type EvidenceContext = ArtifactPaths & {
  rootIdentity: DirectoryIdentity;
  evidenceRootIdentity: DirectoryIdentity;
  directoryIdentity: DirectoryIdentity;
};

async function createEvidenceDirectory(
  canonicalRoot: string,
  action: VisualAction,
  name: string,
  now: Date,
): Promise<EvidenceContext> {
  const teraxRoot = resolve(canonicalRoot, ".terax");
  const evidenceRoot = resolve(teraxRoot, "visual-qa");
  if (!isInside(canonicalRoot, evidenceRoot)) {
    throw new Error("Visual QA output escaped the trusted project");
  }
  await ensurePrivateDirectory(teraxRoot);
  await ensurePrivateDirectory(evidenceRoot);
  if ((await realpath(evidenceRoot)) !== evidenceRoot) {
    throw new Error("Visual QA evidence root must be canonical");
  }
  const prefix = resolve(
    evidenceRoot,
    `${timestampId(now)}-${sanitizeArtifactName(name)}-`,
  );
  const directory = await mkdtemp(prefix);
  await chmod(directory, 0o700);
  await applyNativeWindowsDirectoryProtection(evidenceRoot);
  await applyNativeWindowsDirectoryProtection(directory);
  return {
    ...pathsForDirectory(directory, action),
    rootIdentity: await directoryIdentity(canonicalRoot),
    evidenceRootIdentity: await directoryIdentity(evidenceRoot),
    directoryIdentity: await directoryIdentity(directory),
  };
}

async function assertEvidenceContext(context: EvidenceContext): Promise<void> {
  await assertDirectoryIdentity(context.rootIdentity);
  await assertDirectoryIdentity(context.evidenceRootIdentity);
  await assertDirectoryIdentity(context.directoryIdentity);
}

async function finalizeArtifact(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("Visual QA backend did not create a regular artifact");
  }
  await chmod(path, 0o600);
}

function linkedController(external?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(external?.reason);
  if (external?.aborted) abort();
  else external?.addEventListener("abort", abort, { once: true });
  return {
    controller,
    cleanup: () => external?.removeEventListener("abort", abort),
  };
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function runVisualQa(
  request: VisualQaRequest | ValidatedVisualQaRequest,
  options: {
    projectRoot: string;
    pid: number;
    backend: VisualBackend;
    guard: (signal?: AbortSignal) => Promise<void>;
    guardIntervalMs?: number;
    now?: Date;
    signal?: AbortSignal;
    beforeBaselineOpen?: () => Promise<void> | void;
  },
): Promise<VisualQaResult> {
  const validated = validateVisualQaRequest(request);
  const selector = surfaceSelector(validated.surface, options.pid);
  const canonicalRoot = await realpath(resolve(options.projectRoot));
  const rootStats = await stat(canonicalRoot);
  if (!rootStats.isDirectory()) throw new Error("Trusted project root must be a directory");
  const baseline = validated.baselinePath
    ? await resolveBaseline(canonicalRoot, validated.baselinePath)
    : undefined;

  const linked = linkedController(options.signal);
  const signal = linked.controller.signal;
  let paths: EvidenceContext | undefined;
  let baselineSnapshotPath: string | undefined;
  let guardTimer: ReturnType<typeof setInterval> | undefined;
  let guardError: unknown;
  let guardRunning = false;
  const checkGuard = async () => {
    if (guardRunning || guardError) return;
    guardRunning = true;
    try {
      await options.guard(signal);
    } catch (error) {
      guardError = error;
      linked.controller.abort(error);
    } finally {
      guardRunning = false;
    }
  };

  try {
    signal.throwIfAborted();
    await options.guard(signal);
    signal.throwIfAborted();
    paths = await createEvidenceDirectory(
      canonicalRoot,
      validated.action,
      validated.name,
      options.now ?? new Date(),
    );
    if (baseline) {
      await assertEvidenceContext(paths);
      baselineSnapshotPath = resolve(paths.directory, ".baseline-snapshot");
      await snapshotBaseline(baseline, baselineSnapshotPath, options.beforeBaselineOpen);
      await finalizeArtifact(baselineSnapshotPath);
    }

    let window: WindowDescriptor;
    let previewWindow: WindowDescriptor | undefined;
    let imagePath: string;
    let score: number | undefined;
    guardTimer = setInterval(
      () => void checkGuard(),
      options.guardIntervalMs ?? DEFAULT_GUARD_INTERVAL_MS,
    );

    if (validated.action === "video") {
      try {
        await assertEvidenceContext(paths);
        window = await options.backend.record(
          selector,
          paths.mediaPath,
          validated.durationSeconds,
          validated.fps,
          signal,
        );
        await assertEvidenceContext(paths);
        await finalizeArtifact(paths.mediaPath);
      } catch (error) {
        if (guardError) throw guardError;
        throw error;
      }
      if (guardError) throw guardError;
      await options.guard(signal);
      await assertEvidenceContext(paths);
      previewWindow = await options.backend.capture(selector, paths.previewPath, signal);
      await assertEvidenceContext(paths);
      await finalizeArtifact(paths.previewPath);
      await options.guard(signal);
      imagePath = paths.previewPath;
    } else {
      await assertEvidenceContext(paths);
      window = await options.backend.capture(selector, paths.mediaPath, signal);
      await assertEvidenceContext(paths);
      await finalizeArtifact(paths.mediaPath);
      await options.guard(signal);
      imagePath = paths.mediaPath;
      if (validated.action === "compare") {
        await assertEvidenceContext(paths);
        score = await options.backend.compare(
          paths.mediaPath,
          baselineSnapshotPath as string,
          signal,
        );
        await options.guard(signal);
      }
    }

    clearInterval(guardTimer);
    guardTimer = undefined;
    await checkGuard();
    while (guardRunning) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
    }
    if (guardError) throw guardError;

    const result: VisualQaResult = {
      action: validated.action,
      surface: validated.surface,
      captureSucceeded: true,
      ...(score === undefined || validated.threshold === undefined
        ? {}
        : { baselinePassed: score >= validated.threshold }),
      mediaPath: paths.mediaPath,
      imagePath,
      reportPath: paths.reportPath,
      window,
      ...(previewWindow === undefined ? {} : { previewWindow }),
      ...(score === undefined ? {} : { score }),
      ...(validated.threshold === undefined ? {} : { threshold: validated.threshold }),
      ...(baseline === undefined ? {} : { baselinePath: baseline.path }),
    };
    if (baselineSnapshotPath) {
      await rm(baselineSnapshotPath, { force: true });
      baselineSnapshotPath = undefined;
    }
    await assertEvidenceContext(paths);
    await atomicWriteJson(paths.reportPath, result);
    return result;
  } catch (error) {
    if (paths) {
      try {
        await assertEvidenceContext(paths);
        await rm(paths.directory, { recursive: true, force: true });
      } catch {
        // Never follow or delete a replacement path during failure cleanup.
      }
    }
    throw guardError ?? error;
  } finally {
    if (guardTimer) clearInterval(guardTimer);
    linked.cleanup();
  }
}
