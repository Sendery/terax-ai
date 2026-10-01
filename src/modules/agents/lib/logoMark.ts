// The Terax logo ships as a finished app icon: a light ribbon on a dark,
// gradient squircle. A notification icon puts the ribbon on the tab's colour,
// so the squircle is made transparent by luminance, with a soft ramp so the
// ribbon's own shading and anti-aliased edge survive.
const MARK_LUMA_FLOOR = 85;
const MARK_LUMA_RAMP = 45;
/** Keeps the squircle's light rim out of the mark. */
const MARK_EDGE_INSET = 26;

/** Rewrites the alpha of an RGBA buffer in place so only the ribbon remains. */
export function extractLogoMark(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside =
        x >= MARK_EDGE_INSET &&
        y >= MARK_EDGE_INSET &&
        x < width - MARK_EDGE_INSET &&
        y < height - MARK_EDGE_INSET;
      if (!inside) {
        rgba[i + 3] = 0;
        continue;
      }
      const luma = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
      const keep = Math.min(
        1,
        Math.max(0, (luma - MARK_LUMA_FLOOR) / MARK_LUMA_RAMP),
      );
      rgba[i + 3] = Math.round(rgba[i + 3] * keep);
    }
  }
}
