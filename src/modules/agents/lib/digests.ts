import { native } from "@/modules/ai/lib/native";
import { useAgentStore } from "../store/agentStore";
import type { AgentHarness, SessionDigest } from "./types";

type DigestAgent = "claude" | "pi" | "codex";

/** Agents whose transcripts the digest reader understands. */
function digestAgentFor(harness: AgentHarness): DigestAgent | null {
  return harness === "claude" || harness === "pi" || harness === "codex"
    ? harness
    : null;
}

/**
 * A notification waits this long for a fresh digest and then goes out with
 * what it has: reading is incremental and normally sub-millisecond, but the
 * first read of a large transcript is not, and a late notification is worse
 * than a slightly less detailed one.
 */
const DIGEST_WAIT_MS = 400;

const inflight = new Map<number, Promise<SessionDigest | undefined>>();

/**
 * Reads the digest for one live session and stores it. Concurrent calls for
 * the same pane share one read, so a burst of signals costs one IPC.
 */
export function refreshDigest(
  leafId: number,
  cwd: string | null,
): Promise<SessionDigest | undefined> {
  const running = inflight.get(leafId);
  if (running) return running;
  const session = useAgentStore.getState().sessions[leafId];
  const agent = session ? digestAgentFor(session.harness) : null;
  if (!session || !agent) return Promise.resolve(undefined);

  const read = native
    .agentSessionDigest(agent, session.sessionId, cwd)
    .then((digest) => {
      if (!digest) return undefined;
      const now = useAgentStore.getState().sessions[leafId];
      // The pane may have been rebound or closed while the read ran.
      if (!now || now.sessionId !== session.sessionId) return undefined;
      useAgentStore.getState().setDigest(leafId, digest);
      return digest;
    })
    .catch(() => undefined)
    .finally(() => inflight.delete(leafId));
  inflight.set(leafId, read);
  return read;
}

/** A fresh digest if one arrives in time, else whatever is already known. */
export async function digestForNotification(
  leafId: number,
  cwd: string | null,
): Promise<SessionDigest | undefined> {
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), DIGEST_WAIT_MS),
  );
  const fresh = await Promise.race([refreshDigest(leafId, cwd), timeout]);
  return fresh ?? useAgentStore.getState().digests[leafId];
}
