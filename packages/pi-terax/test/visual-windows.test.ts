import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_OUTPUT_LIMIT_BYTES,
  COMMAND_TIMEOUT_MS,
  buildSsimArgs,
  createSystemWindowsVisualBackend,
  createWindowsVisualBackend,
  encodePowerShell,
  runVisualCommand,
  withWslInteropEnv,
  type VisualCommandRunner,
} from "../src/visual-windows.js";

const descriptor =
  '{"handle":"0x102A","pid":123,"processName":"terax","title":"Terax","x":10,"y":20,"width":800,"height":600}';
const selector = { pid: 123, processName: "terax" as const, title: "Terax" as const };

describe("Windows Terax visual backend", () => {
  it("encodes PowerShell scripts as UTF-16LE", () => {
    expect(
      Buffer.from(encodePowerShell("Write-Output 'Terax'"), "base64").toString(
        "utf16le",
      ),
    ).toBe("Write-Output 'Terax'");
  });

  it("forwards capture variables through WSL interop", () => {
    expect(
      withWslInteropEnv(
        { TERAX_VISUAL_HANDLE: "0x102A", TERAX_VISUAL_OUTPUT: "C:\\a.png" },
        "EXISTING/u",
      ),
    ).toMatchObject({
      WSLENV: "EXISTING/u:TERAX_VISUAL_HANDLE:TERAX_VISUAL_OUTPUT",
    });
  });

  it("builds an SSIM command without a shell", () => {
    expect(buildSsimArgs("C:\\current.png", "C:\\baseline.png")).toEqual([
      "-hide_banner",
      "-i",
      "C:\\current.png",
      "-i",
      "C:\\baseline.png",
      "-lavfi",
      "ssim",
      "-f",
      "null",
      "-",
    ]);
  });

  it("binds discovery and immediate capture revalidation to exact pid, process, and title", async () => {
    const run = vi
      .fn<VisualCommandRunner["run"]>()
      .mockResolvedValueOnce({ stdout: descriptor, stderr: "" })
      .mockResolvedValueOnce({ stdout: descriptor, stderr: "" });
    const pathSignals: (AbortSignal | undefined)[] = [];
    const backend = createWindowsVisualBackend({
      powershellPath: "powershell.exe",
      ffmpegPath: "ffmpeg.exe",
      toWindowsPath: async (path, signal) => {
        pathSignals.push(signal);
        return `WIN:${path}`;
      },
      run,
    });
    const controller = new AbortController();

    const window = await backend.capture(
      selector,
      "/tmp/evidence.png",
      controller.signal,
    );

    expect(window.pid).toBe(123);
    expect(run.mock.calls[0]?.[2]?.env).toMatchObject({
      TERAX_VISUAL_PID: "123",
      TERAX_VISUAL_PROCESS: "terax",
      TERAX_VISUAL_TITLE: "",
    });
    expect(run.mock.calls[1]?.[2]?.env).toMatchObject({
      TERAX_VISUAL_HANDLE: "0x102A",
      TERAX_VISUAL_PID: "123",
      TERAX_VISUAL_PROCESS: "terax",
      TERAX_VISUAL_TITLE: "Terax",
      TERAX_VISUAL_OUTPUT: "WIN:/tmp/evidence.png",
    });
    expect(pathSignals).toEqual([controller.signal]);
  });

  it("locks subsequent main captures to the unique authenticated runtime title", async () => {
    const runtimeDescriptor =
      '{"handle":"0x102A","pid":123,"processName":"terax","title":"e2e-fixture","x":10,"y":20,"width":800,"height":600}';
    const run = vi
      .fn<VisualCommandRunner["run"]>()
      .mockResolvedValueOnce({ stdout: runtimeDescriptor, stderr: "" })
      .mockResolvedValueOnce({ stdout: runtimeDescriptor, stderr: "" });
    const backend = createWindowsVisualBackend({
      powershellPath: "powershell.exe",
      ffmpegPath: "ffmpeg.exe",
      toWindowsPath: async (path: string) => path,
      run,
    });

    await expect(backend.capture(selector, "/tmp/main.png")).resolves.toMatchObject({
      title: "e2e-fixture",
    });
    expect(run.mock.calls[0]?.[2]?.env?.TERAX_VISUAL_TITLE).toBe("");
    expect(run.mock.calls[1]?.[2]?.env?.TERAX_VISUAL_TITLE).toBe("e2e-fixture");
  });

  it("records with frame-by-frame identity, fixed dimensions, and byte limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-record-"));
    const output = join(root, "demo.mp4");
    const run = vi
      .fn<VisualCommandRunner["run"]>()
      .mockResolvedValueOnce({ stdout: descriptor, stderr: "" })
      .mockResolvedValueOnce({ stdout: descriptor, stderr: "" })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    const backend = createWindowsVisualBackend({
      powershellPath: "powershell.exe",
      ffmpegPath: "ffmpeg.exe",
      toWindowsPath: async (path) => `WIN:${path}`,
      run,
    });

    await backend.record(selector, output, 3, 15);

    expect(run.mock.calls[1]?.[2]?.env).toMatchObject({
      TERAX_VISUAL_PID: "123",
      TERAX_VISUAL_PROCESS: "terax",
      TERAX_VISUAL_TITLE: "Terax",
      TERAX_VISUAL_EXPECTED_WIDTH: "800",
      TERAX_VISUAL_EXPECTED_HEIGHT: "600",
      TERAX_VISUAL_MAX_FRAMES: expect.any(String),
      TERAX_VISUAL_MAX_TEMP_BYTES: expect.any(String),
    });
    const script = Buffer.from(
      run.mock.calls[1]?.[1]?.[3] ?? "",
      "base64",
    ).toString("utf16le");
    expect(script).toContain("GetWindowThreadProcessId");
    expect(script).toContain("Window identity changed during capture");
    expect(script).toContain("Window size changed during video capture");
    expect(script).toContain("DwmGetWindowAttribute");
  });

  it("aborts video before FFmpeg when the window changes size", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-resize-"));
    const run = vi
      .fn<VisualCommandRunner["run"]>()
      .mockResolvedValueOnce({ stdout: descriptor, stderr: "" })
      .mockRejectedValueOnce(new Error("Window size changed during video capture"));
    const backend = createWindowsVisualBackend({
      powershellPath: "powershell.exe",
      ffmpegPath: "ffmpeg.exe",
      toWindowsPath: async (path: string) => path,
      run,
    });

    await expect(
      backend.record(selector, join(root, "resize.mp4"), 3, 15),
    ).rejects.toThrow("Window size changed during video capture");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("propagates signal and timeout through system backend setup", async () => {
    const calls: Parameters<VisualCommandRunner["run"]>[] = [];
    const runner: VisualCommandRunner = {
      run: vi.fn(async (...args: Parameters<VisualCommandRunner["run"]>) => {
        calls.push(args);
        if (args[0] === "cmd.exe") {
          return { stdout: "C:\\tools\\ffmpeg.exe\r\n", stderr: "" };
        }
        if (args[0] === "wslpath" && args[1]?.[0] === "-u") {
          return { stdout: "/mnt/c/tools/ffmpeg.exe\n", stderr: "" };
        }
        if (args[0] === "powershell.exe") {
          return { stdout: descriptor, stderr: "" };
        }
        return { stdout: "C:\\tmp\\capture.png\n", stderr: "" };
      }),
    };
    const controller = new AbortController();
    const backend = await createSystemWindowsVisualBackend({
      platform: "linux",
      release: "microsoft-standard-WSL2",
      runner,
      signal: controller.signal,
      timeoutMs: 1234,
    });
    await backend.capture(selector, "/tmp/capture.png", controller.signal);

    expect(calls.every(([, , options]) => options?.signal === controller.signal)).toBe(
      true,
    );
    expect(calls.every(([, , options]) => options?.timeoutMs === 1234)).toBe(true);
  });

  it("bounds command output and enforces timeouts without a shell", async () => {
    const largeScript = join(await mkdtemp(join(tmpdir(), "pi-terax-output-")), "large.mjs");
    await writeFile(
      largeScript,
      `process.stdout.write("x".repeat(${COMMAND_OUTPUT_LIMIT_BYTES + 1}))`,
    );
    await expect(
      runVisualCommand(process.execPath, [largeScript], { timeoutMs: COMMAND_TIMEOUT_MS }),
    ).rejects.toThrow("output limit");

    const waitScript = join(await mkdtemp(join(tmpdir(), "pi-terax-timeout-")), "wait.mjs");
    await writeFile(waitScript, "setTimeout(() => {}, 10000)");
    await expect(
      runVisualCommand(process.execPath, [waitScript], { timeoutMs: 10 }),
    ).rejects.toThrow("timed out");
  });
});
