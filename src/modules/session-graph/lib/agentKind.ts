import type { SessionAgent } from "./entries";

/**
 * Maps a detected agent name onto the two agents that persist a navigable
 * transcript. Detection is heuristic and reports free-form names, so this is a
 * closed mapping rather than a cast: anything else has no readable history and
 * must yield null so the panel can say so instead of showing an empty graph.
 */
export function agentKindFromName(agent: string | null | undefined): SessionAgent | null {
  if (!agent) return null;
  const name = agent.toLowerCase();
  // Check claude first: "claude-code" contains neither "pi" as a word nor a
  // conflicting token, but ordering keeps intent explicit.
  if (name.includes("claude")) return "claude";
  if (name === "pi" || name.startsWith("pi-") || name.startsWith("pi ")) return "pi";
  return null;
}
