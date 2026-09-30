export const POOL_MAX_SIZE = 5;
// A hidden busy slot is parked without a WebGL context, so growing past the
// soft cap costs one xterm buffer instead of a snapshot replayed under a TUI
// that kept repainting. Idle surplus slots are reaped back down afterwards.
export const POOL_HARD_MAX_SIZE = 16;

/**
 * Whether the pool should take a new slot rather than steal `victim`, the
 * lowest-scoring bound slot. A protected victim (visible, running a command
 * or agent, or in the alternate screen) must not be serialized mid-output.
 */
export function shouldGrowPool(size: number, victimProtected: boolean): boolean {
  if (size < POOL_MAX_SIZE) return true;
  return victimProtected && size < POOL_HARD_MAX_SIZE;
}
