// Windowed rendering for the graph list.
//
// A transcript can carry thousands of entries, and each row mounts an inline SVG
// for its rail cell. Mounting all of them makes scrolling stutter and slows the
// capture path, so only the visible slice is rendered and the remaining height is
// held by two spacers. Rows are a fixed height, which keeps this arithmetic exact
// and lets the scrollbar stay proportional to the whole transcript.

export type VisibleWindow = {
  /** First rendered index, inclusive. */
  start: number;
  /** Last rendered index, exclusive. */
  end: number;
  /** Spacer height above the slice. */
  padTop: number;
  /** Spacer height below the slice. */
  padBottom: number;
};

const DEFAULT_OVERSCAN = 8;

export function visibleWindow({
  total,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = DEFAULT_OVERSCAN,
}: {
  total: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}): VisibleWindow {
  if (total <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };

  // Guard the degenerate row height rather than producing Infinity indices.
  const height = rowHeight > 0 ? rowHeight : 1;
  // The viewport is zero before first layout; render a screenful anyway so the
  // list is not blank on the first paint.
  const view = viewportHeight > 0 ? viewportHeight : height * 20;
  // Elastic overscroll reports a negative offset on macOS.
  const top = Math.max(0, scrollTop);

  const firstVisible = Math.floor(top / height);
  const count = Math.ceil(view / height);

  const start = Math.max(0, Math.min(total, firstVisible - overscan));
  const end = Math.max(start, Math.min(total, firstVisible + count + overscan));

  return {
    start,
    end,
    padTop: start * height,
    padBottom: (total - end) * height,
  };
}
