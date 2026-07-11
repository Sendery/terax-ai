import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, platform as hostPlatform, release as hostRelease } from "node:os";
import { join } from "node:path";

export const DISCOVERY_COMMAND_TIMEOUT_MS = 5_000;
export const DISCOVERY_OUTPUT_LIMIT_BYTES = 64 * 1024;

export type TeraxDiscovery = {
  version: 1;
  pid: number;
  port: number;
  token: string;
};

export type DiscoveryCommandOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type DiscoveryCommandRunner = {
  run: (
    command: string,
    args: string[],
    options?: DiscoveryCommandOptions,
  ) => Promise<{ stdout: string; stderr: string }>;
};

export type DiscoverOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  release?: string;
  runner?: DiscoveryCommandRunner;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function cacheBaseDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32") {
    return env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  }
  if (platform === "darwin") return join(homedir(), "Library", "Caches");
  return env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}

export function discoveryFilePath(options: DiscoverOptions = {}): string {
  const env = options.env ?? process.env;
  const currentPlatform = options.platform ?? hostPlatform();
  return join(cacheBaseDir(env, currentPlatform), "terax-ai", "pi-bridge.json");
}

function parseDiscovery(value: unknown): TeraxDiscovery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Terax discovery file");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) < 1 ||
    !Number.isInteger(record.port) ||
    typeof record.token !== "string" ||
    record.token.length === 0
  ) throw new Error("Invalid Terax discovery file");
  const port = record.port as number;
  if (port < 1 || port > 65535) throw new Error("Invalid Terax discovery file");
  return { version: 1, pid: record.pid as number, port, token: record.token };
}

async function readDiscovery(path: string): Promise<TeraxDiscovery> {
  const raw = await readFile(path, "utf8");
  return parseDiscovery(JSON.parse(raw));
}

function runDiscoveryCommand(
  command: string,
  args: string[],
  options: DiscoveryCommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new Error("Terax discovery command aborted"));
      return;
    }
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let pendingError: Error | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = options.timeoutMs ?? DISCOVERY_COMMAND_TIMEOUT_MS;
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
      }, 5_000);
    };
    const abort = () => terminate(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("Terax discovery command aborted"),
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => terminate(new Error("Terax discovery command timed out")),
      timeoutMs,
    );
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (pendingError) return;
      bytes += chunk.length;
      if (bytes > DISCOVERY_OUTPUT_LIMIT_BYTES) {
        terminate(new Error("Terax discovery command exceeded output limit"));
      } else target.push(chunk);
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
      const errors = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        settle(() => reject(new Error(`Terax discovery command failed (${code ?? "unknown"}): ${errors.trim()}`)));
      } else {
        settle(() => resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: errors,
        }));
      }
    });
  });
}

async function windowsDiscoveryPathFromWsl(
  options: DiscoverOptions,
): Promise<string> {
  const runner = options.runner ?? { run: runDiscoveryCommand };
  const commandOptions = {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DISCOVERY_COMMAND_TIMEOUT_MS,
  };
  const localAppData = (
    await runner.run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);[Environment]::GetFolderPath('LocalApplicationData')",
      ],
      commandOptions,
    )
  ).stdout.trim();
  if (!localAppData) throw new Error("Windows LOCALAPPDATA discovery returned an empty path");
  const linuxPath = (
    await runner.run("wslpath", ["-u", localAppData], commandOptions)
  ).stdout.trim();
  if (!linuxPath) throw new Error("wslpath returned an empty LOCALAPPDATA path");
  return join(linuxPath, "terax-ai", "pi-bridge.json");
}

export async function discoverTerax(
  options: DiscoverOptions = {},
): Promise<TeraxDiscovery> {
  try {
    return await readDiscovery(discoveryFilePath(options));
  } catch (error) {
    const platform = options.platform ?? hostPlatform();
    const currentRelease = options.release ?? hostRelease();
    const isWsl = platform === "linux" && /microsoft|wsl/i.test(currentRelease);
    if (!isWsl || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readDiscovery(await windowsDiscoveryPathFromWsl(options));
  }
}
