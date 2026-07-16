import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeCaptureTarget } from "./visual.js";
import {
  MAX_CAPTURE_HEIGHT,
  MAX_CAPTURE_PIXELS,
  MAX_CAPTURE_WIDTH,
  MAX_TEMP_BYTES,
  buildVideoArgs,
  parseSsim,
  type VisualBackend,
  type WindowDescriptor,
  type WindowSelector,
} from "./visual.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FFMPEG_TIMEOUT_MS = 90_000;

export type NativeCaptureClient = {
  call: (command: "app.capture", payload?: unknown) => Promise<unknown>;
};

export type CaptureOutcome = {
  path: string;
  width: number;
  height: number;
  bytes: number;
};

export function parseCaptureOutcome(value: unknown): CaptureOutcome {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid native capture outcome");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.path !== "string" ||
    record.path.length === 0 ||
    record.format !== "png" ||
    !Number.isInteger(record.width) ||
    !Number.isInteger(record.height) ||
    !Number.isInteger(record.bytes) ||
    (record.width as number) < 1 ||
    (record.height as number) < 1 ||
    (record.bytes as number) < 1 ||
    (record.width as number) > MAX_CAPTURE_WIDTH ||
    (record.height as number) > MAX_CAPTURE_HEIGHT ||
    (record.width as number) * (record.height as number) > MAX_CAPTURE_PIXELS
  ) {
    throw new Error("Invalid native capture outcome");
  }
  return {
    path: record.path,
    width: record.width as number,
    height: record.height as number,
    bytes: record.bytes as number,
  };
}

async function assertPngArtifact(path: string): Promise<void> {
  const header = (await readFile(path)).subarray(0, PNG_MAGIC.length);
  if (!header.equals(PNG_MAGIC)) {
    throw new Error("Native capture did not produce a PNG artifact");
  }
}

function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ stderr: Buffer.concat(chunks).toString("utf8") });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("FFmpeg timed out"));
    }, FFMPEG_TIMEOUT_MS);
    const onAbort = () => {
      child.kill();
      finish(new Error("FFmpeg aborted"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish();
      else
        finish(
          new Error(
            `FFmpeg failed (${code}): ${Buffer.concat(chunks).toString("utf8").slice(-2000)}`,
          ),
        );
    });
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Native capture aborted"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type NativeVisualBackendOptions = {
  client: NativeCaptureClient;
  pid: number;
  target: NativeCaptureTarget;
  tabId?: number;
  ffmpegPath?: string;
};

export function createNativeVisualBackend(
  options: NativeVisualBackendOptions,
): VisualBackend {
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  const payload =
    options.target === "pane"
      ? { target: options.target, tabId: options.tabId }
      : { target: options.target };

  async function captureOnce(
    selector: WindowSelector,
    outputPath: string,
  ): Promise<WindowDescriptor> {
    const outcome = parseCaptureOutcome(
      await options.client.call("app.capture", payload),
    );
    try {
      await assertPngArtifact(outcome.path);
      await copyFile(outcome.path, outputPath);
    } finally {
      await rm(outcome.path, { force: true });
    }
    return {
      handle: "0x0",
      pid: options.pid,
      processName: selector.processName,
      title: selector.title,
      x: 0,
      y: 0,
      width: outcome.width,
      height: outcome.height,
    };
  }

  return {
    capture: (selector, outputPath, signal) => {
      signal?.throwIfAborted();
      return captureOnce(selector, outputPath);
    },
    record: async (selector, outputPath, durationSeconds, fps, signal) => {
      const framesDir = await mkdtemp(join(tmpdir(), "terax-native-frames-"));
      try {
        const frameCount = Math.max(1, Math.ceil(durationSeconds * fps));
        const intervalMs = 1000 / fps;
        let descriptor: WindowDescriptor | undefined;
        let totalBytes = 0;
        for (let index = 0; index < frameCount; index += 1) {
          signal?.throwIfAborted();
          const framePath = join(
            framesDir,
            `frame-${String(index).padStart(5, "0")}.png`,
          );
          const frame = await captureOnce(selector, framePath);
          if (!descriptor) descriptor = frame;
          else if (
            frame.width !== descriptor.width ||
            frame.height !== descriptor.height
          ) {
            throw new Error("Capture dimensions changed during recording");
          }
          totalBytes += (await stat(framePath)).size;
          if (totalBytes > MAX_TEMP_BYTES) {
            throw new Error("Recording exceeded the temporary frame budget");
          }
          if (index < frameCount - 1) await sleep(intervalMs, signal);
        }
        await runFfmpeg(
          ffmpegPath,
          buildVideoArgs(join(framesDir, "frame-%05d.png"), outputPath, fps),
          signal,
        );
        return descriptor as WindowDescriptor;
      } finally {
        await rm(framesDir, { recursive: true, force: true });
      }
    },
    compare: async (currentPath, baselinePath, signal) => {
      const { stderr } = await runFfmpeg(
        ffmpegPath,
        [
          "-hide_banner",
          "-i",
          currentPath,
          "-i",
          baselinePath,
          "-filter_complex",
          "ssim",
          "-f",
          "null",
          "-",
        ],
        signal,
      );
      return parseSsim(stderr);
    },
  };
}
