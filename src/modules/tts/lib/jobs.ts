import type { TtsJob } from "@/modules/tts/lib/native";

/**
 * The job a card speaks for: the one still running, or else the most recent,
 * whose log stays readable after it ends.
 */
export function pickJob(
  jobs: TtsJob[],
  match: (job: TtsJob) => boolean,
): TtsJob | null {
  const candidates = jobs.filter(match);
  if (candidates.length === 0) return null;
  const running = candidates.find((job) => job.state === "running");
  if (running) return running;
  return candidates.reduce((latest, job) =>
    job.startedAtMs > latest.startedAtMs ? job : latest,
  );
}

/**
 * Whether a card must show work in progress. A finished job is kept so its log
 * can still be read, so only a running one may spin a button or disable it;
 * treating any job as busy leaves the button stuck after a failed install.
 */
export function isRunning(job: TtsJob | null): boolean {
  return job?.state === "running";
}
