import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { native } from "@/modules/ai/lib/native";

import { parseSessionLines, type SessionAgent, type ParsedSession } from "./entries";
import { buildSessionGraph, EMPTY_SESSION_GRAPH, type SessionGraph } from "./graph";

/** How often a live transcript is polled for appended entries. */
const FOLLOW_MS = 1500;

export type TranscriptState = {
  graph: SessionGraph;
  parsed: ParsedSession | null;
  loading: boolean;
  error: string | null;
  totalBytes: number;
  /** True while the transcript grew on the most recent poll. */
  live: boolean;
};

const EMPTY: TranscriptState = {
  graph: EMPTY_SESSION_GRAPH,
  parsed: null,
  loading: false,
  error: null,
  totalBytes: 0,
  live: false,
};

/**
 * Loads a transcript and follows it while it grows.
 *
 * The native reader returns entries projected down to what a row renders, and
 * accepts a byte offset, so following a running agent costs only the appended
 * bytes rather than re-reading a multi-megabyte file.
 */
export function useSessionTranscript(
  agent: SessionAgent | null,
  sessionId: string | null,
  /**
   * Entry to treat as HEAD instead of the file's last one, so the panel can
   * follow a branch the agent abandoned. Ignored when it is not in the file.
   */
  headOverride: string | null = null,
): TranscriptState & { reload: () => void } {
  const [state, setState] = useState<TranscriptState>(EMPTY);
  // Accumulated reduced JSONL. Kept in a ref so a poll appends instead of
  // re-reading, and so re-renders do not reset progress.
  const bufferRef = useRef("");
  const offsetRef = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);
  // Read through a ref so changing the branch does not restart the file read.
  const headRef = useRef(headOverride);
  headRef.current = headOverride;

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    // Every run of this effect is a fresh start: the agent changed, the session
    // changed, or a reload was requested. Discard accumulated bytes, otherwise
    // one transcript's entries get appended onto another's.
    void reloadToken;
    bufferRef.current = "";
    offsetRef.current = 0;

    if (!agent || !sessionId) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    let timer = 0;

    const pull = async (isFirst: boolean) => {
      if (isFirst) setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const slice = await native.agentSessionRead(agent, sessionId, offsetRef.current);
        if (cancelled) return;

        const grew = slice.jsonl.length > 0;
        // A shorter file means it was rewritten: start over rather than
        // stitching two different transcripts together.
        if (slice.totalBytes < offsetRef.current) {
          bufferRef.current = "";
          offsetRef.current = 0;
        }
        if (grew) bufferRef.current += slice.jsonl;
        offsetRef.current = slice.nextOffset;

        const parsed = parseSessionLines(bufferRef.current, agent);
        setState({
          graph: buildSessionGraph(parsed.nodes, headRef.current ?? parsed.headId),
          parsed,
          loading: false,
          error: null,
          totalBytes: slice.totalBytes,
          live: grew && !isFirst,
        });
      } catch (cause) {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        }));
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void pull(false), FOLLOW_MS);
      }
    };

    void pull(true);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [agent, sessionId, reloadToken]);

  // Switching branch only changes which ancestry is "active", so the layout is
  // recomputed from the parsed entries rather than re-reading the transcript.
  const graph = useMemo(
    () =>
      state.parsed
        ? buildSessionGraph(state.parsed.nodes, headOverride ?? state.parsed.headId)
        : state.graph,
    [state.parsed, state.graph, headOverride],
  );

  return useMemo(() => ({ ...state, graph, reload }), [state, graph, reload]);
}
