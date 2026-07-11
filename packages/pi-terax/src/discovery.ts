import { readFile } from "node:fs/promises";
import { homedir, platform as hostPlatform } from "node:os";
import { join } from "node:path";

export type TeraxDiscovery = {
  version: 1;
  pid: number;
  port: number;
  token: string;
};

export type DiscoverOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

function cacheBaseDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32") {
    return env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Caches");
  }
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
    !Number.isInteger(record.pid) ||
    !Number.isInteger(record.port) ||
    typeof record.token !== "string" ||
    record.token.length === 0
  ) {
    throw new Error("Invalid Terax discovery file");
  }
  const port = record.port as number;
  if (port < 1 || port > 65535) {
    throw new Error("Invalid Terax discovery file");
  }
  return {
    version: 1,
    pid: record.pid as number,
    port,
    token: record.token,
  };
}

export async function discoverTerax(
  options: DiscoverOptions = {},
): Promise<TeraxDiscovery> {
  const raw = await readFile(discoveryFilePath(options), "utf8");
  return parseDiscovery(JSON.parse(raw));
}
