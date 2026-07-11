import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DISCOVERY_COMMAND_TIMEOUT_MS,
  discoverTerax,
  type DiscoveryCommandRunner,
} from "../src/discovery.js";

describe("discoverTerax", () => {
  it("loads and validates native Linux discovery first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-terax-"));
    const cacheDir = join(dir, "cache");
    const file = join(cacheDir, "terax-ai", "pi-bridge.json");
    await mkdir(join(cacheDir, "terax-ai"), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ version: 1, pid: 123, port: 40123, token: "tok" }),
    );
    const runner: DiscoveryCommandRunner = { run: vi.fn() };

    await expect(
      discoverTerax({
        env: { XDG_CACHE_HOME: cacheDir },
        platform: "linux",
        release: "microsoft-standard-WSL2",
        runner,
      }),
    ).resolves.toEqual({ version: 1, pid: 123, port: 40123, token: "tok" });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("falls back in WSL to Windows LOCALAPPDATA with fixed commands and propagated controls", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-wsl-"));
    const windowsCache = join(root, "LocalAppData");
    await mkdir(join(windowsCache, "terax-ai"), { recursive: true });
    await writeFile(
      join(windowsCache, "terax-ai", "pi-bridge.json"),
      JSON.stringify({ version: 1, pid: 777, port: 40222, token: "wsl" }),
    );
    const controller = new AbortController();
    const run = vi
      .fn<DiscoveryCommandRunner["run"]>()
      .mockResolvedValueOnce({ stdout: "C:\\Users\\test\\AppData\\Local\r\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: `${windowsCache}\n`, stderr: "" });

    await expect(
      discoverTerax({
        env: { XDG_CACHE_HOME: join(root, "missing") },
        platform: "linux",
        release: "microsoft-standard-WSL2",
        runner: { run },
        signal: controller.signal,
        timeoutMs: 321,
      }),
    ).resolves.toMatchObject({ pid: 777, token: "wsl" });
    expect(run.mock.calls[0]?.slice(0, 2)).toEqual([
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);[Environment]::GetFolderPath('LocalApplicationData')"],
    ]);
    expect(run.mock.calls[1]?.slice(0, 2)).toEqual([
      "wslpath",
      ["-u", "C:\\Users\\test\\AppData\\Local"],
    ]);
    expect(run.mock.calls.every(([, , options]) =>
      options?.signal === controller.signal && options.timeoutMs === 321,
    )).toBe(true);
  });

  it("preserves non-ASCII Windows LOCALAPPDATA when PowerShell emits UTF-8", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-terax-unicode-"));
    const windowsCache = join(root, "Andrés", "AppData", "Local");
    await mkdir(join(windowsCache, "terax-ai"), { recursive: true });
    await writeFile(
      join(windowsCache, "terax-ai", "pi-bridge.json"),
      JSON.stringify({ version: 1, pid: 778, port: 40223, token: "unicode" }),
    );
    const run = vi
      .fn<DiscoveryCommandRunner["run"]>()
      .mockResolvedValueOnce({ stdout: "C:\\Users\\Andrés\\AppData\\Local\r\n", stderr: "" })
      .mockResolvedValueOnce({ stdout: `${windowsCache}\n`, stderr: "" });

    await expect(
      discoverTerax({
        env: { XDG_CACHE_HOME: join(root, "missing") },
        platform: "linux",
        release: "microsoft-standard-WSL2",
        runner: { run },
      }),
    ).resolves.toMatchObject({ pid: 778, token: "unicode" });

    expect(run.mock.calls[0]?.[1]).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);[Environment]::GetFolderPath('LocalApplicationData')",
    ]);
  });

  it("uses bounded discovery command defaults", () => {
    expect(DISCOVERY_COMMAND_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DISCOVERY_COMMAND_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("rejects malformed discovery data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-terax-"));
    const cacheDir = join(dir, "cache");
    await mkdir(join(cacheDir, "terax-ai"), { recursive: true });
    await writeFile(
      join(cacheDir, "terax-ai", "pi-bridge.json"),
      JSON.stringify({ version: 2, port: "bad", token: "" }),
    );
    await expect(
      discoverTerax({ env: { XDG_CACHE_HOME: cacheDir }, platform: "linux" }),
    ).rejects.toThrow("Invalid Terax discovery file");
  });
});
