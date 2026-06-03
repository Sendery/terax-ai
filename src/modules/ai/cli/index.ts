export { runCliAgentStream, type RunCliAgentOptions } from "./stream";
export {
  installedCliAgents,
  isCliAgentInstalled,
  useCliAvailabilityStore,
} from "./availability";
export {
  CLI_AGENTS,
  CLI_AGENT_IDS,
  CLI_AGENT_BINS,
  type CliAgentDef,
} from "./registry";
export { detectCliAgents } from "./bridge";
export type { CliAgentId, CliPermissionMode } from "./types";
