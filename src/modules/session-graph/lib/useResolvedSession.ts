import { useEffect, useMemo, useState } from "react";

import { native } from "@/modules/ai/lib/native";

import type { SessionAgent } from "./entries";
import { pickSession, type SessionCandidate } from "./pickSession";
import {
  buildSessionGroups,
  type SessionSourceGroup,
  type TerminalBinding,
  type TerminalSource,
} from "./terminalSources";

/**
 * Resolves the transcripts behind every open terminal.
 *
 * Terax cannot ask a running agent for its session id: agent detection is
 * heuristic (an OSC marker plus process inspection) and carries no session
 * identity. So transcripts are resolved from a terminal's cwd, which both CLIs
 * encode into their own project directory.
 *
 * Every open terminal is probed, not just the focused one, because resolution
 * by directory is a heuristic: two agents of the same kind in one directory are
 * indistinguishable, and the user needs to be able to reach any of them. The
 * detected agent is only a hint, absent once the agent exits, and history stays
 * worth reading then, so both agents are probed and `pickSession` decides.
 */
export function useResolvedSession(
  agentHint: SessionAgent | null,
  binding: TerminalBinding | null,
  sources: readonly TerminalSource[],
): {
  agent: SessionAgent | null;
  sessionId: string | null;
  candidates: SessionCandidate[];
  groups: SessionSourceGroup[];
} {
  const [sessionsByCwd, setSessionsByCwd] = useState<
    ReadonlyMap<string, SessionCandidate[]>
  >(() => new Map());

  // Panes commonly share a directory, and the probe is a directory listing per
  // agent, so it runs once per distinct cwd.
  const cwds = useMemo(
    () => [...new Set(sources.map((source) => source.cwd))].sort(),
    [sources],
  );
  const cwdKey = cwds.join("\n");

  useEffect(() => {
    const targets = cwdKey ? cwdKey.split("\n") : [];
    if (targets.length === 0) {
      setSessionsByCwd(new Map());
      return;
    }

    let cancelled = false;
    void (async () => {
      const found = new Map<string, SessionCandidate[]>();
      for (const cwd of targets) {
        const list: SessionCandidate[] = [];
        // Probe both agents: a directory can hold transcripts from either.
        for (const agent of ["pi", "claude"] as const) {
          try {
            for (const info of await native.agentSessionsList(agent, cwd, 25)) {
              list.push({
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
        found.set(cwd, list);
      }
      if (!cancelled) setSessionsByCwd(found);
    })();

    return () => {
      cancelled = true;
    };
  }, [cwdKey]);

  const groups = useMemo(
    () => buildSessionGroups(sources, sessionsByCwd),
    [sources, sessionsByCwd],
  );

  const candidates = useMemo(
    () => (binding ? (sessionsByCwd.get(binding.cwd) ?? []) : []),
    [binding, sessionsByCwd],
  );

  const chosen = pickSession(candidates, agentHint);
  return {
    agent: chosen?.agent ?? null,
    sessionId: chosen?.id ?? null,
    candidates,
    groups,
  };
}
