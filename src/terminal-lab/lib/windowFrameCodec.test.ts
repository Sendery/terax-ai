import { expect, it } from "vitest";
import { decodeWindowFrames } from "@/terminal-lab/lib/windowFrameCodec";
import { encodeFrame, textRow } from "@/modules/terminal/gl/frameCodec.testing";

function frame(seq = 1): ArrayBuffer {
  return encodeFrame({
    seq,
    cols: 8,
    rows: 2,
    rowRecords: [textRow(0, "hello")],
  });
}

function packet(members: [number, ArrayBuffer][]): ArrayBuffer {
  const buffer = new ArrayBuffer(
    8 + members.reduce((n, [, f]) => n + 8 + f.byteLength, 0),
  );
  const view = new DataView(buffer);
  view.setUint32(0, 0x31575854, true);
  view.setUint16(4, members.length, true);
  let offset = 8;
  for (const [route, bytes] of members) {
    view.setUint32(offset, route, true);
    view.setUint32(offset + 4, bytes.byteLength, true);
    new Uint8Array(buffer, offset + 8, bytes.byteLength).set(
      new Uint8Array(bytes),
    );
    offset += 8 + bytes.byteLength;
  }
  return buffer;
}

it("validates ordered routes and every inner V1 frame without copying", () => {
  const buffer = packet([
    [0, frame()],
    [11, frame()],
    [0, frame(2)],
  ]);
  let tick = 10;
  const decoded = decodeWindowFrames(buffer, new Set([0, 11]), () => tick++);
  expect(decoded.map((m) => [m.route, m.frame.seq])).toEqual([
    [0, 1],
    [11, 1],
    [0, 2],
  ]);
  for (const member of decoded) {
    expect(member.frame.u32.buffer).toBe(buffer);
    expect(member.decodeMs).toBe(1);
  }
  expect(decoded.map((m) => m.decodedAt)).toEqual([11, 13, 15]);
});

it("rejects a malformed later member before returning any applicable frames", () => {
  const buffer = packet([
    [0, frame()],
    [1, frame()],
  ]);
  const second = 8 + 8 + frame().byteLength + 8;
  new DataView(buffer).setUint16(second + 32, 0xffff, true);
  const apply = () =>
    decodeWindowFrames(buffer, new Set([0, 1])).forEach(applied);
  const seen: number[] = [];
  function applied(value: { route: number }) {
    seen.push(value.route);
  }
  expect(apply).toThrow();
  expect(seen).toEqual([]);
});

it("rejects unknown routes, duplicate sequences, bad envelope headers and trailing bytes", () => {
  const valid = packet([[0, frame()]]);
  const altered = (at: number, value: number, width = 4) => {
    const copy = valid.slice(0);
    if (width === 2) new DataView(copy).setUint16(at, value, true);
    else new DataView(copy).setUint32(at, value, true);
    return copy;
  };
  const trailing = new ArrayBuffer(valid.byteLength + 4);
  new Uint8Array(trailing).set(new Uint8Array(valid));
  for (const invalid of [
    packet([]),
    packet([[12, frame()]]),
    packet([[1, frame()]]),
    packet([
      [0, frame()],
      [0, frame()],
    ]),
    altered(0, 0),
    altered(4, 25, 2),
    altered(6, 1, 2),
    altered(12, 0),
    altered(12, 0xffffffff),
    trailing,
  ])
    expect(() => decodeWindowFrames(invalid, new Set([0]))).toThrow();
});

it("rejects every truncated envelope and oversized data before typed-view construction", () => {
  const valid = packet([
    [0, frame()],
    [1, frame()],
  ]);
  for (let n = 0; n < valid.byteLength; n++)
    expect(() =>
      decodeWindowFrames(valid.slice(0, n), new Set([0, 1])),
    ).toThrow();
  expect(() =>
    decodeWindowFrames(new ArrayBuffer(8 * 1024 * 1024 + 4), new Set()),
  ).toThrow();
  expect(() =>
    decodeWindowFrames(
      packet([[0, new ArrayBuffer(256 * 1024 + 4)]]),
      new Set([0]),
    ),
  ).toThrow();
});
