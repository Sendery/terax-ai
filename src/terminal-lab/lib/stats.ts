export type Distribution = {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

/** Nearest-rank percentiles, rounded to 0.1 ms. */
export function distribution(samples: readonly number[]): Distribution {
  if (samples.length === 0) {
    return { count: 0, p50: null, p95: null, max: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    count: sorted.length,
    p50: round(rank(0.5)),
    p95: round(rank(0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}

/** Gaps between consecutive timestamps. */
export function intervals(stamps: readonly number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
  return gaps;
}

export function perSecond(amount: number, ms: number): number | null {
  if (ms <= 0) return null;
  return Math.round((amount / ms) * 1000 * 10) / 10;
}

/** Records animation frame timestamps until stopped. */
export function sampleAnimationFrames(): { stop: () => number[] } {
  const stamps: number[] = [];
  let running = true;
  const tick = (t: number) => {
    if (!running) return;
    stamps.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop: () => {
      running = false;
      return stamps;
    },
  };
}
