import { create } from "zustand";
import {
  CLI_AGENTS,
  CLI_AGENT_BINS,
  type CliAgentDef,
} from "./registry";
import { detectCliAgents } from "./bridge";
import type { CliAgentId } from "./types";

type CliAvailabilityState = {
  paths: Record<string, string | null>;
  hydrated: boolean;
  refresh: () => Promise<Record<string, string | null>>;
};

export const useCliAvailabilityStore = create<CliAvailabilityState>(
  (set) => ({
    paths: {},
    hydrated: false,
    refresh: async () => {
      const paths = await detectCliAgents(CLI_AGENT_BINS);
      set({ paths, hydrated: true });
      return paths;
    },
  }),
);

export function isCliAgentInstalled(
  paths: Record<string, string | null>,
  id: CliAgentId,
): boolean {
  return !!paths[CLI_AGENTS[id].bin];
}

export function installedCliAgents(
  paths: Record<string, string | null>,
): CliAgentDef[] {
  return (Object.keys(CLI_AGENTS) as CliAgentId[])
    .filter((id) => isCliAgentInstalled(paths, id))
    .map((id) => CLI_AGENTS[id]);
}
