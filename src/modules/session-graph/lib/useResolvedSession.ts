import { useEffect, useState } from "react";

import { native } from "@/modules/ai/lib/native";

import type { SessionAgent } from "./entries";
import { pickSession, type SessionCandidate } from "./pickSession";

/**
 * Resolves which transcript belongs to the selected terminal.
 *
 * Terax cannot ask a running agent for its session id: agent detection is
 * heuristic (an OSC marker plus process inspection) and carries no session
 * identity. So the transcript is resolved from the terminal's cwd, which both
 * CLIs encode into their own project directory.
 *
 * The detected agent is only a hint. It is absent whenever the agent already
 * exited, and history is still worth reading then, so both agents are probed and
 * `pickSession` decides.
 *
 * This is a heuristic: with two agents of the same kind in one directory it can
 * pick the wrong transcript, which is why the resolved list is returned too.
 */
export function useResolvedSession(
  agentHint: SessionAgent | null,
  cwd: string | null,
): {
  agent: SessionAgent | null;
  sessionId: string | null;
  candidates: SessionCandidate[];
} {
  const [candidates, setCandidates] = useState<SessionCandidate[]>([]);

  useEffect(() => {
    if (!cwd) {
      setCandidates([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const found: SessionCandidate[] = [];
      // Probe both agents: a directory can hold transcripts from either.
      for (const agent of ["pi", "claude"] as const) {
        try {
          const list = await native.agentSessionsList(agent, cwd, 25);
          for (const info of list) {
            found.push({
              id: info.id,
              agent,
              modifiedMs: info.modifiedMs,
              parentSessionId: info.parentSessionId,
            });
          }
        } catch {
          // A missing agent directory is normal, not an error.
        }
      }
      if (!cancelled) setCandidates(found);
    })();

    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const chosen = pickSession(candidates, agentHint);
  return {
    agent: chosen?.agent ?? null,
    sessionId: chosen?.id ?? null,
    candidates,
  };
}
