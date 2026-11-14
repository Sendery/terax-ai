import {
  decodeFrame,
  type DecodedFrame,
} from "@/modules/terminal/gl/frameCodec";

export const WINDOW_FRAME_MAGIC = 0x31575854;
export const WINDOW_FRAME_ROUTES = 12;
export const WINDOW_FRAME_LIMIT = 24;
export const WINDOW_FRAME_BYTES = 256 * 1024;
export const WINDOW_ENVELOPE_BYTES = 8 * 1024 * 1024;

export type WindowFrame = {
  route: number;
  frame: DecodedFrame;
  decodeMs: number;
  decodedAt: number | null;
};

export function decodeWindowFrames(
  buffer: ArrayBuffer,
  routes: ReadonlySet<number>,
  clock?: () => number,
): WindowFrame[] {
  if (
    buffer.byteLength < 8 ||
    buffer.byteLength > WINDOW_ENVELOPE_BYTES ||
    buffer.byteLength % 4 !== 0
  )
    throw new Error("invalid window frame envelope size");
  const view = new DataView(buffer);
  const count = view.getUint16(4, true);
  if (
    view.getUint32(0, true) !== WINDOW_FRAME_MAGIC ||
    view.getUint16(6, true) !== 0 ||
    count === 0 ||
    count > WINDOW_FRAME_LIMIT
  )
    throw new Error("invalid window frame envelope header");
  const result: WindowFrame[] = [];
  const previous = new Map<number, number>();
  let offset = 8;
  let lastClock = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > buffer.byteLength)
      throw new Error("truncated window frame record");
    const route = view.getUint32(offset, true);
    const length = view.getUint32(offset + 4, true);
    offset += 8;
    if (route >= WINDOW_FRAME_ROUTES || !routes.has(route))
      throw new Error("unknown window frame route");
    if (
      length < 36 ||
      length > WINDOW_FRAME_BYTES ||
      length % 4 !== 0 ||
      length > buffer.byteLength - offset
    )
      throw new Error("invalid inner window frame length");
    const start = clock?.() ?? null;
    const frame = decodeFrame(buffer, offset, length);
    const end = clock?.() ?? null;
    if (
      start !== null &&
      end !== null &&
      (!Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < lastClock ||
        end < start)
    )
      throw new Error("invalid window frame clock");
    if (end !== null) lastClock = end;
    const prior = previous.get(route);
    if (frame.seq === 0 || (prior !== undefined && frame.seq !== prior + 1))
      throw new Error("invalid window frame sequence");
    previous.set(route, frame.seq);
    result.push({
      route,
      frame,
      decodeMs: start === null || end === null ? 0 : end - start,
      decodedAt: end,
    });
    offset += length;
  }
  if (offset !== buffer.byteLength)
    throw new Error("trailing window frame bytes");
  return result;
}
