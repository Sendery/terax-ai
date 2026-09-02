import { useCallback, useEffect, useRef, useState } from "react";
import {
  runningJobsOf,
  ttsNative,
  type TtsJob,
  type TtsStatus,
} from "@/modules/tts/lib/native";
import { useTtsStore } from "@/modules/tts/store/ttsStore";

export const TTS_POLL_MS = 2000;
/** Keeps a long install log from growing without bound in memory. */
const MAX_LOG_CHARS = 64 * 1024;

export type TtsRuntime = {
  status: TtsStatus | null;
  jobs: TtsJob[];
  runningJobs: TtsJob[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logs: Record<string, string>;
  tailJobLog: (jobId: number) => Promise<void>;
  forgetJobLog: (jobId: number) => void;
};

/**
 * Polls `tts_status` while mounted. Nothing here runs unless the Voice tab is
 * open, which is what keeps an unused feature at zero cost.
 */
export function useTtsRuntime(enabled = true): TtsRuntime {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const offsets = useRef(new Map<number, number>());
  const alive = useRef(true);

  const tailJobLog = useCallback(async (jobId: number) => {
    const since = offsets.current.get(jobId) ?? 0;
    try {
      const tail = await ttsNative.jobLogs(jobId, since);
      offsets.current.set(jobId, tail.nextOffset);
      if (!alive.current) return;
      if (tail.bytes.length === 0 && tail.dropped === 0) return;
      setLogs((prev) => {
        const dropNotice =
          tail.dropped > 0 ? `\n[${tail.dropped} bytes dropped]\n` : "";
        const next = `${prev[jobId] ?? ""}${dropNotice}${tail.bytes}`;
        return {
          ...prev,
          [jobId]:
            next.length > MAX_LOG_CHARS ? next.slice(-MAX_LOG_CHARS) : next,
        };
      });
    } catch {
      // A job that has already been reaped has no log; not worth surfacing.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await ttsNative.status();
      if (!alive.current) return;
      setStatus(next);
      setError(null);
      useTtsStore.getState().setStatus(next);
      await Promise.all(runningJobsOf(next).map((job) => tailJobLog(job.id)));
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [tailJobLog]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A timeout chain instead of an interval: a slow status read can never
    // stack up overlapping invokes.
    const tick = async () => {
      await refresh();
      if (!alive.current) return;
      timer = setTimeout(() => void tick(), TTS_POLL_MS);
    };
    void tick();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, refresh]);

  const forgetJobLog = useCallback((jobId: number) => {
    offsets.current.delete(jobId);
    setLogs((prev) => {
      if (prev[jobId] === undefined) return prev;
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }, []);

  return {
    status,
    jobs: status?.jobs ?? [],
    runningJobs: runningJobsOf(status),
    loading,
    error,
    refresh,
    logs,
    tailJobLog,
    forgetJobLog,
  };
}
