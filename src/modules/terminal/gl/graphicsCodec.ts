export const MAX_GRAPHICS_BYTES = 32 * 1024 * 1024;
export const MAX_GRAPHICS_PLACEMENTS = 4096;
export const MAX_GRAPHICS_DIMENSION = 8192;
export type GraphicImage = {
  id: number;
  key: string;
  width: number;
  height: number;
  pixels: Uint8Array;
};
export type GraphicPlacement = {
  id: number;
  key: string;
  z: number;
  col: number;
  row: number;
  offsetX: number;
  offsetY: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
};
export type DecodedGraphics = {
  cellWidth: number;
  cellHeight: number;
  images: readonly GraphicImage[];
  placements: readonly GraphicPlacement[];
};
export function decodeGraphics(
  u32: Uint32Array,
  start: number,
  full: boolean,
): { graphics: DecodedGraphics; word: number } {
  let at = start;
  const fail = (): never => {
    throw new Error("invalid native graphics table");
  };
  const word = (): number => {
    if (at >= u32.length) return fail();
    return u32[at++];
  };
  const stamp = (): string => {
    const lo = word(),
      hi = word();
    if (lo === 0 && hi === 0) return fail();
    return [hi.toString(16), lo.toString(16)].join(":");
  };
  const version = word();
  if (version !== 1 && version !== 2) return fail();
  const floatWords = new Float32Array(u32.buffer, u32.byteOffset, u32.length);
  const geometry = (): number => {
    if (version === 1) return word();
    if (at >= floatWords.length) return fail();
    const value = floatWords[at++];
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000)
      return fail();
    return value;
  };
  const cellWidth = word(),
    cellHeight = word(),
    imageCount = word(),
    placementCount = word();
  if (
    cellWidth < 1 ||
    cellWidth > 512 ||
    cellHeight < 1 ||
    cellHeight > 512 ||
    imageCount > MAX_GRAPHICS_PLACEMENTS ||
    placementCount > MAX_GRAPHICS_PLACEMENTS
  )
    return fail();
  const images = new Map<string, GraphicImage>();
  let bytes = 0;
  for (let i = 0; i < imageCount; i++) {
    const id = word(),
      key = stamp(),
      width = word(),
      height = word(),
      length = word();
    bytes += length;
    if (
      id === 0 ||
      images.has(key) ||
      width < 1 ||
      width > MAX_GRAPHICS_DIMENSION ||
      height < 1 ||
      height > MAX_GRAPHICS_DIMENSION ||
      length !== width * height * 4 ||
      bytes > MAX_GRAPHICS_BYTES ||
      length / 4 > u32.length - at
    )
      return fail();
    images.set(key, {
      id,
      key,
      width,
      height,
      pixels: new Uint8Array(u32.buffer, u32.byteOffset + at * 4, length),
    });
    at += length / 4;
  }
  const placements: GraphicPlacement[] = [];
  const used = new Set<string>();
  for (let i = 0; i < placementCount; i++) {
    const id = word(),
      key = stamp(),
      z = word() | 0,
      col = word() | 0,
      row = word() | 0;
    const offsetX = geometry(),
      offsetY = geometry(),
      sourceX = geometry(),
      sourceY = geometry();
    const sourceWidth = geometry(),
      sourceHeight = geometry(),
      width = geometry(),
      height = geometry();
    const image = images.get(key);
    if (
      id === 0 ||
      width === 0 ||
      height === 0 ||
      sourceWidth === 0 ||
      sourceHeight === 0 ||
      offsetX >= cellWidth ||
      offsetY >= cellHeight ||
      (full && !image) ||
      (image &&
        (image.id !== id ||
          sourceX + sourceWidth > image.width + 0.001 ||
          sourceY + sourceHeight > image.height + 0.001))
    )
      return fail();
    used.add(key);
    placements.push({
      id,
      key,
      z,
      col,
      row,
      offsetX,
      offsetY,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      width,
      height,
    });
  }
  for (const key of images.keys()) if (!used.has(key)) return fail();
  placements.sort((a, b) => a.z - b.z || a.id - b.id);
  if ((at - start) * 4 > MAX_GRAPHICS_BYTES + MAX_GRAPHICS_PLACEMENTS * 80 + 20)
    return fail();
  return {
    graphics: {
      cellWidth,
      cellHeight,
      images: [...images.values()],
      placements,
    },
    word: at,
  };
}
