import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { release as hostRelease } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  MAX_CAPTURE_HEIGHT,
  MAX_CAPTURE_PIXELS,
  MAX_CAPTURE_WIDTH,
  MAX_TEMP_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_FPS,
  MAX_VIDEO_FRAMES,
  buildVideoArgs,
  parseSsim,
  parseWindowDescriptor,
  type VisualBackend,
  type WindowDescriptor,
  type WindowSelector,
} from "./visual.js";

export const COMMAND_OUTPUT_LIMIT_BYTES = 1024 * 1024;
export const COMMAND_TIMEOUT_MS = 45_000;
export const COMMAND_TERMINATION_GRACE_MS = 5_000;
export const MAX_RECORD_COMMAND_TIMEOUT_MS = 90_000;

export function recordCommandTimeoutMs(durationSeconds: number): number {
  return Math.min(
    MAX_RECORD_COMMAND_TIMEOUT_MS,
    Math.max(COMMAND_TIMEOUT_MS, Math.ceil(durationSeconds * 1_000) + 30_000),
  );
}

export type VisualCommandOptions = {
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type VisualCommandResult = { stdout: string; stderr: string };

export type VisualCommandRunner = {
  run: (
    command: string,
    args: string[],
    options?: VisualCommandOptions,
  ) => Promise<VisualCommandResult>;
};

export type WindowsVisualRuntime = VisualCommandRunner & {
  powershellPath: string;
  ffmpegPath: string;
  toWindowsPath: (path: string, signal?: AbortSignal) => Promise<string>;
  timeoutMs?: number;
};

const WINDOW_API = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TeraxVisualWindowApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
`;

const SCRIPT_HELPERS = String.raw`
function Get-ExactWindowIdentity([IntPtr]$handle) {
  if (-not [TeraxVisualWindowApi]::IsWindow($handle)) { throw "Terax window no longer exists" }
  [uint32]$actualPid = 0
  [void][TeraxVisualWindowApi]::GetWindowThreadProcessId($handle, [ref]$actualPid)
  $length = [TeraxVisualWindowApi]::GetWindowTextLength($handle)
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][TeraxVisualWindowApi]::GetWindowText($handle, $builder, $builder.Capacity)
  try { $process = [System.Diagnostics.Process]::GetProcessById($actualPid) } catch { throw "Terax process no longer exists" }
  if ($actualPid -ne [uint32]$env:TERAX_VISUAL_PID -or
      -not [String]::Equals($process.ProcessName, $env:TERAX_VISUAL_PROCESS, [StringComparison]::OrdinalIgnoreCase) -or
      -not [String]::Equals($builder.ToString(), $env:TERAX_VISUAL_TITLE, [StringComparison]::Ordinal)) {
    throw "Window identity changed during capture"
  }
  return $process.ProcessName
}
function Get-CaptureBounds([IntPtr]$handle) {
  $windowRect = New-Object TeraxVisualWindowApi+RECT
  if (-not [TeraxVisualWindowApi]::GetWindowRect($handle, [ref]$windowRect)) { throw "Cannot read Terax window bounds" }
  $frameRect = New-Object TeraxVisualWindowApi+RECT
  $dwmResult = [TeraxVisualWindowApi]::DwmGetWindowAttribute($handle, 9, [ref]$frameRect, [Runtime.InteropServices.Marshal]::SizeOf($frameRect))
  if ($dwmResult -ne 0) { $frameRect = $windowRect }
  $windowWidth = $windowRect.Right - $windowRect.Left
  $windowHeight = $windowRect.Bottom - $windowRect.Top
  $width = $frameRect.Right - $frameRect.Left
  $height = $frameRect.Bottom - $frameRect.Top
  $offsetX = $frameRect.Left - $windowRect.Left
  $offsetY = $frameRect.Top - $windowRect.Top
  if ($windowWidth -lt 1 -or $windowHeight -lt 1 -or $width -lt 1 -or $height -lt 1 -or
      $offsetX -lt 0 -or $offsetY -lt 0 -or $offsetX + $width -gt $windowWidth -or $offsetY + $height -gt $windowHeight) {
    throw "Terax window has invalid bounds"
  }
  if ($windowWidth -gt ${MAX_CAPTURE_WIDTH} -or $windowHeight -gt ${MAX_CAPTURE_HEIGHT} -or
      ([int64]$windowWidth * [int64]$windowHeight) -gt ${MAX_CAPTURE_PIXELS} -or
      $width -gt ${MAX_CAPTURE_WIDTH} -or $height -gt ${MAX_CAPTURE_HEIGHT} -or
      ([int64]$width * [int64]$height) -gt ${MAX_CAPTURE_PIXELS}) {
    throw "Window dimensions exceed visual capture limits"
  }
  return [pscustomobject]@{ windowWidth=$windowWidth; windowHeight=$windowHeight; width=$width; height=$height; offsetX=$offsetX; offsetY=$offsetY; x=$frameRect.Left; y=$frameRect.Top }
}
function Save-PrivateWindow([IntPtr]$handle, [string]$path, $bounds) {
  Get-ExactWindowIdentity $handle | Out-Null
  $fullBitmap = New-Object System.Drawing.Bitmap $bounds.windowWidth, $bounds.windowHeight
  $graphics = [System.Drawing.Graphics]::FromImage($fullBitmap)
  try {
    $hdc = $graphics.GetHdc()
    try {
      Get-ExactWindowIdentity $handle | Out-Null
      $captured = [TeraxVisualWindowApi]::PrintWindow($handle, $hdc, 2)
    }
    finally { $graphics.ReleaseHdc($hdc) }
    if (-not $captured) { throw "PrintWindow failed during private capture" }
    $crop = New-Object System.Drawing.Rectangle $bounds.offsetX, $bounds.offsetY, $bounds.width, $bounds.height
    $cropped = $fullBitmap.Clone($crop, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try { $cropped.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $cropped.Dispose() }
  } finally {
    $graphics.Dispose()
    $fullBitmap.Dispose()
  }
  $processName = Get-ExactWindowIdentity $handle
  $finalBounds = Get-CaptureBounds $handle
  [pscustomobject]@{
    handle = ('0x{0:X}' -f $handle.ToInt64()); pid = [int]$env:TERAX_VISUAL_PID; processName = $processName; title = $env:TERAX_VISUAL_TITLE
    x = $finalBounds.x; y = $finalBounds.y; width = $finalBounds.width; height = $finalBounds.height
  }
}
`;

const DISCOVER_WINDOW_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
${WINDOW_API}
'@
$expectedPid = [uint32]$env:TERAX_VISUAL_PID
$script:teraxWindows = @()
$callback = [TeraxVisualWindowApi+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if (-not [TeraxVisualWindowApi]::IsWindowVisible($hWnd)) { return $true }
  [uint32]$actualPid = 0
  [void][TeraxVisualWindowApi]::GetWindowThreadProcessId($hWnd, [ref]$actualPid)
  if ($actualPid -ne $expectedPid) { return $true }
  $length = [TeraxVisualWindowApi]::GetWindowTextLength($hWnd)
  if ($length -lt 1) { return $true }
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][TeraxVisualWindowApi]::GetWindowText($hWnd, $builder, $builder.Capacity)
  $title = $builder.ToString()
  if (-not [String]::Equals($title, $env:TERAX_VISUAL_TITLE, [StringComparison]::Ordinal)) { return $true }
  try { $process = [System.Diagnostics.Process]::GetProcessById($actualPid) } catch { return $true }
  if (-not [String]::Equals($process.ProcessName, $env:TERAX_VISUAL_PROCESS, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  $frameRect = New-Object TeraxVisualWindowApi+RECT
  if ([TeraxVisualWindowApi]::DwmGetWindowAttribute($hWnd, 9, [ref]$frameRect, [Runtime.InteropServices.Marshal]::SizeOf($frameRect)) -ne 0) {
    if (-not [TeraxVisualWindowApi]::GetWindowRect($hWnd, [ref]$frameRect)) { return $true }
  }
  $script:teraxWindows += [pscustomobject]@{
    handle = ('0x{0:X}' -f $hWnd.ToInt64()); pid = [int]$actualPid; processName = $process.ProcessName; title = $title
    x = $frameRect.Left; y = $frameRect.Top; width = $frameRect.Right - $frameRect.Left; height = $frameRect.Bottom - $frameRect.Top
  }
  return $true
}
[void][TeraxVisualWindowApi]::EnumWindows($callback, [IntPtr]::Zero)
if ($script:teraxWindows.Count -ne 1) { throw "Expected exactly one authenticated Terax window, found $($script:teraxWindows.Count)" }
$script:teraxWindows[0] | ConvertTo-Json -Compress
`;

const CAPTURE_WINDOW_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
${WINDOW_API}
'@
${SCRIPT_HELPERS}
$handle = [IntPtr]([Convert]::ToInt64($env:TERAX_VISUAL_HANDLE.Substring(2), 16))
Get-ExactWindowIdentity $handle | Out-Null
$bounds = Get-CaptureBounds $handle
$descriptor = Save-PrivateWindow $handle $env:TERAX_VISUAL_OUTPUT $bounds
$descriptor | ConvertTo-Json -Compress
`;

const RECORD_WINDOW_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
${WINDOW_API}
'@
${SCRIPT_HELPERS}
$handle = [IntPtr]([Convert]::ToInt64($env:TERAX_VISUAL_HANDLE.Substring(2), 16))
$duration = [double]$env:TERAX_VISUAL_DURATION
$fps = [int]$env:TERAX_VISUAL_FPS
$frameCount = [int][Math]::Ceiling($duration * $fps)
if ($frameCount -gt [int]$env:TERAX_VISUAL_MAX_FRAMES) { throw "Video exceeds frame limit" }
$expectedWidth = [int]$env:TERAX_VISUAL_EXPECTED_WIDTH
$expectedHeight = [int]$env:TERAX_VISUAL_EXPECTED_HEIGHT
$maxBytes = [int64]$env:TERAX_VISUAL_MAX_TEMP_BYTES
$totalBytes = [int64]0
$intervalMs = 1000.0 / $fps
$watch = [System.Diagnostics.Stopwatch]::StartNew()
for ($index = 0; $index -lt $frameCount; $index++) {
  Get-ExactWindowIdentity $handle | Out-Null
  $bounds = Get-CaptureBounds $handle
  if ($bounds.width -ne $expectedWidth -or $bounds.height -ne $expectedHeight) { throw "Window size changed during video capture" }
  $framePath = Join-Path $env:TERAX_VISUAL_FRAME_DIR ('frame-{0:D6}.png' -f $index)
  $descriptor = Save-PrivateWindow $handle $framePath $bounds
  $totalBytes += (Get-Item -LiteralPath $framePath).Length
  if ($totalBytes -gt $maxBytes) { throw "Temporary frame bytes exceed limit" }
  $sleepMs = [int][Math]::Floor((($index + 1) * $intervalMs) - $watch.Elapsed.TotalMilliseconds)
  if ($sleepMs -gt 0) { Start-Sleep -Milliseconds $sleepMs }
}
$descriptor | ConvertTo-Json -Compress
`;

export function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function buildSsimArgs(currentPath: string, baselinePath: string): string[] {
  return [
    "-hide_banner", "-i", currentPath, "-i", baselinePath,
    "-lavfi", "ssim", "-f", "null", "-",
  ];
}

function powerShellArgs(script: string): string[] {
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)];
}

function commandOptions(
  runtime: WindowsVisualRuntime,
  signal?: AbortSignal,
  env?: NodeJS.ProcessEnv,
): VisualCommandOptions {
  return { env, signal, timeoutMs: runtime.timeoutMs ?? COMMAND_TIMEOUT_MS };
}

function assertSameWindow(
  before: WindowDescriptor,
  after: WindowDescriptor,
  selector: WindowSelector,
): void {
  if (
    after.handle.toLowerCase() !== before.handle.toLowerCase() ||
    after.pid !== selector.pid ||
    after.processName.toLowerCase() !== selector.processName ||
    after.title !== selector.title ||
    after.x !== before.x ||
    after.y !== before.y ||
    after.width !== before.width ||
    after.height !== before.height
  ) {
    throw new Error("Window identity or geometry changed during capture");
  }
}

function selectorEnv(selector: WindowSelector): NodeJS.ProcessEnv {
  return {
    TERAX_VISUAL_PID: String(selector.pid),
    TERAX_VISUAL_PROCESS: selector.processName,
    TERAX_VISUAL_TITLE: selector.title,
  };
}

async function discoverWindow(
  runtime: WindowsVisualRuntime,
  selector: WindowSelector,
  signal?: AbortSignal,
): Promise<WindowDescriptor> {
  const result = await runtime.run(
    runtime.powershellPath,
    powerShellArgs(DISCOVER_WINDOW_SCRIPT),
    commandOptions(runtime, signal, selectorEnv(selector)),
  );
  const window = parseWindowDescriptor(result.stdout);
  if (
    window.pid !== selector.pid ||
    window.processName.toLowerCase() !== selector.processName ||
    window.title !== selector.title
  ) {
    throw new Error("Discovered window did not match authenticated identity");
  }
  return window;
}

export function createWindowsVisualBackend(runtime: WindowsVisualRuntime): VisualBackend {
  return {
    async capture(selector, outputPath, signal) {
      const window = await discoverWindow(runtime, selector, signal);
      const nativeOutput = await runtime.toWindowsPath(outputPath, signal);
      const captured = await runtime.run(
        runtime.powershellPath,
        powerShellArgs(CAPTURE_WINDOW_SCRIPT),
        commandOptions(runtime, signal, {
          ...selectorEnv(selector),
          TERAX_VISUAL_HANDLE: window.handle,
          TERAX_VISUAL_OUTPUT: nativeOutput,
        }),
      );
      const finalWindow = parseWindowDescriptor(captured.stdout);
      assertSameWindow(window, finalWindow, selector);
      return finalWindow;
    },
    async record(selector, outputPath, durationSeconds, fps, signal) {
      if (
        !Number.isFinite(durationSeconds) ||
        durationSeconds < 1 ||
        durationSeconds > MAX_VIDEO_DURATION_SECONDS
      ) throw new Error("Video duration must be between 1 and 30 seconds");
      if (!Number.isInteger(fps) || fps < 1 || fps > MAX_VIDEO_FPS) {
        throw new Error("Video FPS must be an integer between 1 and 30");
      }
      const frameCount = Math.ceil(durationSeconds * fps);
      if (frameCount > MAX_VIDEO_FRAMES) throw new Error("Video exceeds frame limit");
      const window = await discoverWindow(runtime, selector, signal);
      const nativeOutput = await runtime.toWindowsPath(outputPath, signal);
      const stem = basename(outputPath).replace(/\.[^.]+$/, "");
      const frameDir = await mkdtemp(join(dirname(outputPath), `.${stem}.frames-`));
      try {
        const nativeFrameDir = await runtime.toWindowsPath(frameDir, signal);
        const recorded = await runtime.run(
          runtime.powershellPath,
          powerShellArgs(RECORD_WINDOW_SCRIPT),
          {
            ...commandOptions(runtime, signal, {
              ...selectorEnv(selector),
              TERAX_VISUAL_HANDLE: window.handle,
              TERAX_VISUAL_FRAME_DIR: nativeFrameDir,
              TERAX_VISUAL_DURATION: String(durationSeconds),
              TERAX_VISUAL_FPS: String(fps),
              TERAX_VISUAL_EXPECTED_WIDTH: String(window.width),
              TERAX_VISUAL_EXPECTED_HEIGHT: String(window.height),
              TERAX_VISUAL_MAX_FRAMES: String(MAX_VIDEO_FRAMES),
              TERAX_VISUAL_MAX_TEMP_BYTES: String(MAX_TEMP_BYTES),
            }),
            timeoutMs: runtime.timeoutMs ?? recordCommandTimeoutMs(durationSeconds),
          },
        );
        const finalWindow = parseWindowDescriptor(recorded.stdout);
        assertSameWindow(window, finalWindow, selector);
        await runtime.run(
          runtime.ffmpegPath,
          buildVideoArgs(`${nativeFrameDir}\\frame-%06d.png`, nativeOutput, fps),
          commandOptions(runtime, signal),
        );
      } finally {
        await rm(frameDir, { recursive: true, force: true });
      }
      return window;
    },
    async compare(currentPath, baselinePath, signal) {
      const nativeCurrent = await runtime.toWindowsPath(currentPath, signal);
      const nativeBaseline = await runtime.toWindowsPath(baselinePath, signal);
      const result = await runtime.run(
        runtime.ffmpegPath,
        buildSsimArgs(nativeCurrent, nativeBaseline),
        commandOptions(runtime, signal),
      );
      return parseSsim(result.stderr);
    },
  };
}

export function withWslInteropEnv(
  env: NodeJS.ProcessEnv,
  current = process.env.WSLENV ?? "",
): NodeJS.ProcessEnv {
  const forwarded = Object.keys(env)
    .filter((key) => key.startsWith("TERAX_VISUAL_") && env[key] !== undefined)
    .map((key) => key);
  const existing = current.split(":").filter(Boolean);
  const names = new Set(existing.map((entry) => entry.split("/")[0]));
  return {
    ...env,
    WSLENV: [...existing, ...forwarded.filter((entry) => !names.has(entry.split("/")[0]))].join(":"),
  };
}

export function runVisualCommand(
  command: string,
  args: string[],
  options: VisualCommandOptions = {},
): Promise<VisualCommandResult> {
  return new Promise((resolveResult, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new Error("Visual capture command aborted"));
      return;
    }
    const mergedEnv = { ...process.env, ...options.env };
    const env = process.platform === "linux" && /microsoft|wsl/i.test(hostRelease())
      ? withWslInteropEnv(mergedEnv)
      : mergedEnv;
    const child = spawn(command, args, {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let pendingError: Error | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
    const outputLimit = options.maxOutputBytes ?? COMMAND_OUTPUT_LIMIT_BYTES;
    const cleanup = () => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", abort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const terminate = (error: Error) => {
      if (settled || pendingError) return;
      pendingError = error;
      child.kill();
      graceTimer = setTimeout(() => {
        child.kill("SIGKILL");
        settle(() => reject(error));
      }, COMMAND_TERMINATION_GRACE_MS);
    };
    const abort = () => terminate(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("Visual capture command aborted"),
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => terminate(new Error(`Visual capture command timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (pendingError) return;
      outputBytes += chunk.length;
      if (outputBytes > outputLimit) {
        terminate(new Error(`Visual capture command exceeded ${outputLimit} byte output limit`));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", (error) => {
      if (child.pid === undefined) settle(() => reject(error));
      else terminate(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      if (pendingError) {
        settle(() => reject(pendingError));
        return;
      }
      const output = Buffer.concat(stdout).toString("utf8");
      const errors = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        settle(() => reject(new Error(
          `Visual capture command failed (${code ?? "unknown"}): ${errors.trim().slice(0, 2000)}`,
        )));
      } else {
        settle(() => resolveResult({ stdout: output, stderr: errors }));
      }
    });
  });
}

export type SystemVisualBackendOptions = {
  platform?: NodeJS.Platform;
  release?: string;
  runner?: VisualCommandRunner;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function createSystemWindowsVisualBackend(
  options: SystemVisualBackendOptions = {},
): Promise<VisualBackend> {
  const platform = options.platform ?? process.platform;
  const currentRelease = options.release ?? hostRelease();
  const isWindows = platform === "win32";
  const isWsl = platform === "linux" && /microsoft|wsl/i.test(currentRelease);
  if (!isWindows && !isWsl) {
    throw new Error("Terax visual capture currently supports Windows and WSL");
  }
  const runner = options.runner ?? { run: runVisualCommand };
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const runText = async (command: string, args: string[], signal = options.signal) =>
    (await runner.run(command, args, { signal, timeoutMs })).stdout.trim();

  let ffmpegPath = "ffmpeg.exe";
  if (isWsl) {
    const windowsFfmpeg = (await runText("cmd.exe", ["/d", "/c", "where", "ffmpeg"]))
      .split(/\r?\n/).find(Boolean);
    if (!windowsFfmpeg) throw new Error("Windows FFmpeg was not found in PATH");
    ffmpegPath = await runText("wslpath", ["-u", windowsFfmpeg]);
  }
  const toWindowsPath = isWindows
    ? async (path: string, signal?: AbortSignal) => {
        if (signal?.aborted) throw signal.reason;
        return path;
      }
    : async (path: string, signal?: AbortSignal) =>
        runText("wslpath", ["-w", path], signal);

  return createWindowsVisualBackend({
    powershellPath: "powershell.exe",
    ffmpegPath,
    toWindowsPath,
    timeoutMs,
    run: runner.run,
  });
}
