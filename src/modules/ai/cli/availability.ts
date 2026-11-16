import { create } from "zustand";
import {
  CLI_PROVIDERS,
  providerNeedsKey,
  type ProviderId,
} from "@/modules/ai/config";
import { CLI_BINARIES } from "./binaries";
import { detectCliAgents } from "./bridge";

type CliPaths = Record<string, string | null>;
type Availability = {
  paths: CliPaths;
  status: "idle" | "loading" | "ready" | "error";
};
export const useCliAvailabilityStore = create<Availability>(() => ({
  paths: {},
  status: "idle",
}));
let pending: Promise<void> | null = null;
let invalidated = false;

/** Ephemeral per-webview cache; refresh only on explicit lifecycle/user events. */
export function refreshCliAvailability(options?: {
  invalidate?: boolean;
}): Promise<void> {
  if (pending) {
    invalidated ||= options?.invalidate === true;
    return pending;
  }
  pending = Promise.resolve().then(async () => {
    try {
      do {
        invalidated = false;
        try {
          const paths = await detectCliAgents(Object.values(CLI_BINARIES));
          if (!invalidated)
            useCliAvailabilityStore.setState({ paths, status: "ready" });
        } catch {
          if (!invalidated)
            useCliAvailabilityStore.setState({ paths: {}, status: "error" });
        }
      } while (invalidated);
    } finally {
      pending = null;
    }
  });
  useCliAvailabilityStore.setState({ status: "loading" });
  return pending;
}

export function cliProviderInstalled(
  provider: ProviderId,
  paths: CliPaths,
): boolean {
  const agent = CLI_PROVIDERS[provider];
  if (!agent) return false;
  const path = paths[CLI_BINARIES[agent]];
  return typeof path === "string" && path.trim().length > 0;
}

export function hasInstalledCli(paths: CliPaths): boolean {
  return Object.keys(CLI_PROVIDERS).some((provider) =>
    cliProviderInstalled(provider as ProviderId, paths),
  );
}

export function providerAvailableInPicker(
  provider: ProviderId,
  keys: Partial<Record<ProviderId, string | null>>,
  paths: CliPaths,
): boolean {
  if (CLI_PROVIDERS[provider]) return cliProviderInstalled(provider, paths);
  return providerNeedsKey(provider) ? !!keys[provider] : true;
}
