import { expect, it, vi } from "vitest";
import type { FileLinkStat } from "@/modules/terminal/lib/fileLinks";
import {
  decodeNativeLinkContext,
  resolveNativeLink,
  linkRanges,
  type NativeLinkContext,
} from "@/modules/terminal/gl/nativeLinks";
function context(text: string, offset: number): NativeLinkContext {
  return {
    seq: 1,
    cols: 80,
    viewportRows: 3,
    text,
    offset,
    startClipped: false,
    endClipped: false,
    rows: [
      {
        row: 0,
        startCol: 0,
        cells: Array.from({ length: text.length }, (_, i) => [i, i + 1]),
      },
    ],
    osc8: null,
  };
}
const source = (
  stat: (path: string) => Promise<FileLinkStat | null> = vi.fn(
    async (_path: string) => ({ kind: "file" as const }),
  ),
) => ({ cwd: "/repo", home: "/home/test", stat });
it("finds only the file under the pointer, including its source location", async () => {
  const stat = vi.fn(async (_path: string) => ({ kind: "file" as const }));
  const text = "missing.ts src/main.ts:12:3 ignored.ts";
  const resolved = await resolveNativeLink(
    context(text, text.indexOf(":12") + 1),
    source(stat),
  );
  expect(resolved?.target).toEqual({
    kind: "file",
    path: "/repo/src/main.ts",
    location: { line: 12, column: 3 },
  });
  expect(stat).toHaveBeenCalledExactlyOnceWith("/repo/src/main.ts");
});
it("uses OSC8 destination rather than the label and never falls back from a blocked URI", async () => {
  const c = context("README.md", 2);
  c.osc8 = {
    uri: "https://example.test/destination",
    ranges: [{ row: 0, start: 0, end: 9 }],
  };
  const s = source();
  expect((await resolveNativeLink(c, s))?.target).toEqual({
    kind: "url",
    url: "https://example.test/destination",
  });
  for (const uri of [
    "javascript:alert(1)",
    "data:text/html,test",
    "",
    "https://example.test/\n",
  ]) {
    c.osc8.uri = uri;
    expect(await resolveNativeLink(c, s)).toBeNull();
  }
  expect(s.stat).not.toHaveBeenCalled();
});
it("opens local file URIs only through the same file existence check", async () => {
  const c = context("source", 2);
  c.osc8 = {
    uri: "file:///repo/My%20File.ts#L12",
    ranges: [{ row: 0, start: 0, end: 6 }],
  };
  const s = source();
  expect((await resolveNativeLink(c, s))?.target).toEqual({
    kind: "file",
    path: "/repo/My File.ts",
    location: { line: 12 },
  });
  expect(s.stat).toHaveBeenCalledWith("/repo/My File.ts");
  c.osc8.uri = "file://untrusted-host/repo/file.ts";
  expect(await resolveNativeLink(c, s)).toBeNull();
  const denied = source(vi.fn(async () => null));
  expect(
    await resolveNativeLink(
      { ...c, osc8: { ...c.osc8, uri: "file:///repo/secret" } },
      denied,
    ),
  ).toBeNull();
});
it("recognizes URLs across physical rows and maps UTF16 offsets to wide cells", async () => {
  const c = context("中 https://example.test/route", 5);
  c.rows = [
    {
      row: 0,
      startCol: 0,
      cells: [
        [0, 1],
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
      ],
    },
    {
      row: 1,
      startCol: 0,
      cells: Array.from({ length: c.text.length - 5 }, (_, i) => [
        i + 5,
        i + 6,
      ]),
    },
  ];
  const found = await resolveNativeLink(c, source());
  expect(found?.target).toEqual({
    kind: "url",
    url: "https://example.test/route",
  });
  expect(found?.ranges).toEqual([
    { row: 0, start: 3, end: 6 },
    { row: 1, start: 0, end: c.text.length - 5 },
  ]);
  expect(linkRanges(c, 0, 1)).toEqual([{ row: 0, start: 0, end: 2 }]);
});
it("rejects edge-truncated file candidates and malformed IPC before stat or activation", async () => {
  const c = context("partial.ts", 3);
  c.startClipped = true;
  const s = source();
  expect(await resolveNativeLink(c, s)).toBeNull();
  expect(s.stat).not.toHaveBeenCalled();
  expect(() => decodeNativeLinkContext({ ...c, seq: 2 }, 1, 3, 0)).toThrow();
  expect(() =>
    decodeNativeLinkContext(
      { ...c, rows: [{ row: 0, startCol: 0, cells: [[0, 99999]] }] },
      1,
      3,
      0,
    ),
  ).toThrow();
  expect(decodeNativeLinkContext(context("file.ts", 1), 1, 1, 0)).toMatchObject(
    { text: "file.ts", offset: 1 },
  );
});

it("does not reinterpret punctuation at a clipped token edge as a complete target", async () => {
  for (const [text, startClipped, endClipped] of [
    ["(file.ts", true, false],
    ["file.ts)", false, true],
    ["https://example.test/a.", false, true],
  ] as const) {
    const c = context(text, 3);
    c.startClipped = startClipped;
    c.endClipped = endClipped;
    const s = source();
    expect(await resolveNativeLink(c, s)).toBeNull();
    expect(s.stat).not.toHaveBeenCalled();
  }
});
