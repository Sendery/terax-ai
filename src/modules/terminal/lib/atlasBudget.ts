// xterm's WebGL glyph atlas only ever grows: clearing it wipes the pages but
// keeps their size, and pages merge up to MAX_TEXTURE_SIZE (16384 on Apple
// GPUs). Every WebGL context also holds its own mipmapped copy of each page, so
// days of colourful agent output can pin gigabytes of graphics memory.
export const ATLAS_BUDGET_BYTES = 32 * 1024 * 1024;
export const ATLAS_RESET_MIN_INTERVAL_MS = 60_000;

const BYTES_PER_PIXEL = 4;

export type AtlasPageSize = { readonly width: number; readonly height: number };

export function atlasBytes(pages: Iterable<AtlasPageSize>): number {
  let total = 0;
  for (const page of pages) {
    if (page.width > 0 && page.height > 0) {
      total += page.width * page.height * BYTES_PER_PIXEL;
    }
  }
  return total;
}

/**
 * How long to wait before rebuilding the atlas: `null` while it is within
 * budget, `0` to rebuild now, otherwise the milliseconds left before the rate
 * limit allows it. The limit keeps a screen that genuinely needs a large atlas
 * from rebuilding it in a loop.
 */
export function atlasResetDelay(
  bytes: number,
  lastResetAt: number | null,
  now: number,
  budget: number = ATLAS_BUDGET_BYTES,
  minInterval: number = ATLAS_RESET_MIN_INTERVAL_MS,
): number | null {
  if (bytes <= budget) return null;
  if (lastResetAt === null) return 0;
  return Math.max(0, lastResetAt + minInterval - now);
}
