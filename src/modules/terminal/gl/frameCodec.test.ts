import {
  ATTR_BOLD,
  ATTR_UNDERLINE_SHIFT,
  CURSOR_BAR,
  createRowView,
  decodeFrame,
  FRAME_FLAG_CURSOR_BLINK,
  FRAME_FLAG_FULL,
  FrameDecodeError,
  type FrameErrorCode,
  peekSeq,
  readRow,
  styleAttrs,
} from "@/modules/terminal/gl/frameCodec";
import {
  describeFrame,
  encodeFrame,
  explicit,
  type FrameSpec,
  TAIL,
  textRow,
  wide,
} from "@/modules/terminal/gl/frameCodec.testing";
import { describe, expect, it } from "vitest";

function base(overrides: Partial<FrameSpec> = {}): FrameSpec {
  return {
    seq: 7,
    cols: 10,
    rows: 3,
    cursorX: 2,
    cursorY: 1,
    cursorStyle: CURSOR_BAR,
    flags: FRAME_FLAG_FULL | FRAME_FLAG_CURSOR_BLINK,
    defaultFg: 0xddccbb,
    defaultBg: 0x221100,
    styles: [{}, { fg: explicit(0x0000ff), attrs: ATTR_BOLD | (1 << 8) }],
    rowRecords: [textRow(0, "hi", 1), textRow(2, "a b")],
    ...overrides,
  };
}

function expectError(buffer: ArrayBuffer, code: FrameErrorCode) {
  let caught: unknown;
  try {
    decodeFrame(buffer);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FrameDecodeError);
  expect((caught as FrameDecodeError).code).toBe(code);
}

describe("decodeFrame", () => {
  it("reads the header and row records through views", () => {
    const buffer = encodeFrame(base());
    const frame = decodeFrame(buffer);
    expect(frame.u32.buffer).toBe(buffer);
    expect(frame).toMatchObject({
      seq: 7,
      cols: 10,
      rows: 3,
      cursorX: 2,
      cursorY: 1,
      cursorStyle: CURSOR_BAR,
      full: true,
      rowCount: 2,
      defaultFg: 0xddccbb,
      defaultBg: 0x221100,
      styleCount: 2,
    });
    const row = readRow(frame, 1, createRowView());
    expect(row).toMatchObject({ y: 2, runCount: 1, cellCount: 3, flags: 0 });
    expect(frame.u32[row.cellsAt]).toBe("a".codePointAt(0));
    expect(frame.u32[row.cellsAt + 1]).toBe(0);
    expect(styleAttrs(frame, 1) & ATTR_BOLD).toBe(ATTR_BOLD);
    expect(styleAttrs(frame, 9)).toBe(0);
  });

  it("decodes a frame with no rows", () => {
    const frame = decodeFrame(
      encodeFrame(base({ flags: 0, rowRecords: [], styles: [{}] })),
    );
    expect(frame.rowCount).toBe(0);
    expect(frame.full).toBe(false);
  });

  it("describes a frame in the fixture format", () => {
    const frame = decodeFrame(
      encodeFrame(
        base({
          cursorColor: 0x00ff00,
          rowRecords: [
            {
              y: 0,
              flags: 1 | (1 << 1),
              runs: [
                [1, 2],
                [0, 3],
              ],
              cells: [wide(0x4e16), TAIL, 0x41, 0, 0],
            },
          ],
        }),
      ),
    );
    expect(describeFrame(frame)).toEqual({
      seq: 7,
      cols: 10,
      viewportRows: 3,
      full: true,
      viewportScrolled: false,
      cursor: { x: 2, y: 1, style: "bar", blink: true, color: "#00ff00" },
      defaultFg: "#bbccdd",
      defaultBg: "#001122",
      rows: [
        {
          y: 0,
          wrapped: true,
          prompt: "prompt",
          text: "世A",
          runs: [
            {
              start: 0,
              len: 2,
              fg: "#ff0000",
              bg: null,
              underlineColor: null,
              attrs: ["bold"],
              underline: "single",
            },
            {
              start: 2,
              len: 3,
              fg: null,
              bg: null,
              underlineColor: null,
              attrs: [],
              underline: "none",
            },
          ],
        },
      ],
    });
  });

  it("returns the sequence of an undecodable buffer for acknowledgement", () => {
    const buffer = encodeFrame(base({ seq: 42 }));
    new Uint32Array(buffer)[0] = 0;
    expect(peekSeq(buffer)).toBe(42);
    expect(peekSeq(new ArrayBuffer(4))).toBe(0);
  });
});

describe("decodeFrame rejects malformed input", () => {
  it("rejects a short or misaligned buffer", () => {
    expectError(new ArrayBuffer(0), "truncated");
    expectError(new ArrayBuffer(32), "truncated");
    expectError(new ArrayBuffer(38), "misaligned");
  });

  it("rejects a wrong magic", () => {
    const buffer = encodeFrame(base());
    new Uint32Array(buffer)[0] = 0x31465855;
    expectError(buffer, "bad-magic");
  });

  it("rejects an empty grid, an unknown cursor style and too many rows", () => {
    const zero = encodeFrame(base());
    new Uint16Array(zero)[4] = 0;
    expectError(zero, "bad-header");
    const cursor = encodeFrame(base({ cursorStyle: 5 }));
    expectError(cursor, "bad-header");
    const rows = encodeFrame(base());
    new Uint16Array(rows)[9] = 4;
    expectError(rows, "bad-header");
  });

  it("rejects a style table longer than the frame", () => {
    const buffer = encodeFrame(base({ rowRecords: [] }));
    new Uint16Array(buffer)[16] = 1000;
    expectError(buffer, "bad-style-table");
  });

  it("rejects a row past the grid, out of order or repeated", () => {
    expectError(
      encodeFrame(base({ rowRecords: [textRow(3, "x")] })),
      "bad-row",
    );
    expectError(
      encodeFrame(base({ rowRecords: [textRow(1, "x"), textRow(0, "y")] })),
      "bad-row",
    );
    expectError(
      encodeFrame(base({ rowRecords: [textRow(1, "x"), textRow(1, "y")] })),
      "bad-row",
    );
  });

  it("rejects more cells than columns and runs that miscount cells", () => {
    expectError(
      encodeFrame(base({ rowRecords: [textRow(0, "abcdefghijk")] })),
      "bad-row",
    );
    expectError(
      encodeFrame(
        base({ rowRecords: [{ y: 0, runs: [[0, 1]], cells: [65, 66] }] }),
      ),
      "bad-row",
    );
  });

  it("rejects a run that names a style the table does not have", () => {
    expectError(
      encodeFrame(base({ rowRecords: [textRow(0, "a", 5)] })),
      "bad-row",
    );
  });

  it("rejects a row whose body overruns the frame", () => {
    const buffer = encodeFrame(base({ rowRecords: [textRow(0, "abc")] }));
    const u16 = new Uint16Array(buffer);
    const rowHalfword = 36 / 2 + 2 * 8;
    u16[rowHalfword + 1] = 200;
    expectError(buffer, "truncated");
    const cells = encodeFrame(base({ rowRecords: [textRow(0, "abc")] }));
    new Uint16Array(cells)[rowHalfword + 2] = 9;
    new Uint16Array(cells)[rowHalfword + 5] = 9;
    expectError(cells, "truncated");
  });

  it("rejects bytes after the last row", () => {
    const frame = new Uint8Array(encodeFrame(base()));
    const padded = new Uint8Array(frame.length + 8);
    padded.set(frame);
    expectError(padded.buffer, "trailing-bytes");
  });

  it("terminates on every truncation of a valid frame", () => {
    const whole = new Uint8Array(
      encodeFrame(
        base({
          rowRecords: [
            textRow(0, "styled", 1),
            { y: 1, runs: [[1, 3]], cells: [wide(0x1f600), TAIL, 0x41] },
            textRow(2, "tail"),
          ],
        }),
      ),
    );
    for (let len = 0; len < whole.length; len += 4) {
      expect(() => decodeFrame(whole.slice(0, len).buffer)).toThrow(
        FrameDecodeError,
      );
    }
  });

  it("never reads out of bounds on random corruption", () => {
    const whole = encodeFrame(
      base({
        rowRecords: [
          textRow(0, "random", 1),
          textRow(1, "bytes"),
          textRow(2, "z"),
        ],
      }),
    );
    let state = 0x9e3779b9;
    const next = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    for (let trial = 0; trial < 2000; trial++) {
      const copy = new Uint8Array(whole.slice(0));
      const flips = 1 + (next() % 4);
      for (let f = 0; f < flips; f++) {
        copy[4 + (next() % (copy.length - 4))] = next() & 0xff;
      }
      try {
        const frame = decodeFrame(copy.buffer);
        const row = createRowView();
        for (let i = 0; i < frame.rowCount; i++) {
          readRow(frame, i, row);
          expect(row.cellsAt + row.cellCount).toBeLessThanOrEqual(
            frame.u32.length,
          );
        }
      } catch (error) {
        expect(error).toBeInstanceOf(FrameDecodeError);
      }
    }
  });
});

describe("underline kinds in attrs", () => {
  it("names every kind the contract defines", () => {
    const styles = [0, 1, 2, 3, 4, 5].map((kind) => ({
      attrs: kind << ATTR_UNDERLINE_SHIFT,
    }));
    const frame = decodeFrame(
      encodeFrame(
        base({
          styles,
          rowRecords: [
            {
              y: 0,
              runs: styles.map((_, id) => [id, 1] as [number, number]),
              cells: [65, 66, 67, 68, 69, 70],
            },
          ],
        }),
      ),
    );
    expect(describeFrame(frame).rows[0].runs.map((r) => r.underline)).toEqual([
      "none",
      "single",
      "double",
      "curly",
      "dotted",
      "dashed",
    ]);
  });
});
