import {
  resolveCandidatePath,
  resolveTerminalFileLinkAt,
  splitTerminalFileLocation,
  type FileLinkStat,
  type TerminalFileLocation,
} from "@/modules/terminal/lib/fileLinks";
import {
  safeExternalTerminalUrl,
  terminalUrlAt,
} from "@/modules/terminal/lib/terminalUrls";

export type NativeLinkRange = { row: number; start: number; end: number };
export type NativeLinkContext = {
  seq: number;
  cols: number;
  viewportRows: number;
  text: string;
  offset: number;
  startClipped: boolean;
  endClipped: boolean;
  rows: { row: number; startCol: number; cells: [number, number][] }[];
  osc8: { uri: string; ranges: NativeLinkRange[] } | null;
};
export type NativeLinkTarget =
  | { kind: "url"; url: string }
  | { kind: "file"; path: string; location?: TerminalFileLocation };
export type ResolvedNativeLink = {
  target: NativeLinkTarget;
  ranges: NativeLinkRange[];
};
export type NativeLinkSource = {
  cwd: string | null | undefined;
  home: string | null | undefined;
  stat: (path: string) => Promise<FileLinkStat | null>;
};
const encoder = new TextEncoder();
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid terminal link reply.");
  return value as Record<string, unknown>;
};
const integer = (value: unknown, min: number, max: number): number => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error("Invalid terminal link reply.");
  return value;
};
export function decodeNativeLinkContext(
  value: unknown,
  seq: number,
  col: number,
  row: number,
): NativeLinkContext | null {
  if (value === null) return null;
  const data = record(value);
  if (
    data.seq !== seq ||
    typeof data.text !== "string" ||
    data.text.length > 20480 ||
    encoder.encode(data.text).byteLength > 65536 ||
    typeof data.startClipped !== "boolean" ||
    typeof data.endClipped !== "boolean"
  )
    throw new Error("Invalid terminal link reply.");
  const cols = integer(data.cols, 1, 1000);
  const viewportRows = integer(data.viewportRows, 1, 500);
  const offset = integer(data.offset, 0, data.text.length - 1);
  if (!Array.isArray(data.rows) || data.rows.length > viewportRows)
    throw new Error("Invalid terminal link reply.");
  let count = 0;
  let previousRow = -1;
  const rows = data.rows.map((entry) => {
    const item = record(entry);
    const y = integer(item.row, 0, viewportRows - 1);
    const startCol = integer(item.startCol, 0, cols - 1);
    if (
      y <= previousRow ||
      !Array.isArray(item.cells) ||
      item.cells.length === 0 ||
      item.cells.length > cols - startCol
    )
      throw new Error("Invalid terminal link reply.");
    previousRow = y;
    count += item.cells.length;
    if (count > 41460) throw new Error("Invalid terminal link reply.");
    let previousStart = -1;
    const cells: [number, number][] = item.cells.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2)
        throw new Error("Invalid terminal link reply.");
      const start = integer(pair[0], 0, (data.text as string).length);
      const end = integer(pair[1], start, (data.text as string).length);
      if (start < previousStart)
        throw new Error("Invalid terminal link reply.");
      previousStart = start;
      return [start, end];
    });
    return { row: y, startCol, cells };
  });
  const hit = rows.find((item) => item.row === row);
  const cell = hit?.cells[col - hit.startCol];
  if (!cell || cell[0] !== offset || cell[1] <= offset)
    throw new Error("Invalid terminal link reply.");
  let osc8: NativeLinkContext["osc8"] = null;
  if (data.osc8 !== null) {
    const item = record(data.osc8);
    if (
      typeof item.uri !== "string" ||
      encoder.encode(item.uri).byteLength > 8192 ||
      !Array.isArray(item.ranges) ||
      item.ranges.length === 0 ||
      item.ranges.length > viewportRows
    )
      throw new Error("Invalid terminal link reply.");
    let prior = -1;
    const ranges = item.ranges.map((entry) => {
      const range = record(entry);
      const y = integer(range.row, 0, viewportRows - 1);
      if (y <= prior) throw new Error("Invalid terminal link reply.");
      prior = y;
      const start = integer(range.start, 0, cols - 1);
      const end = integer(range.end, start + 1, cols);
      return { row: y, start, end };
    });
    if (
      !ranges.some(
        (range) => range.row === row && range.start <= col && col < range.end,
      )
    )
      throw new Error("Invalid terminal link reply.");
    osc8 = { uri: item.uri, ranges };
  }
  return {
    seq,
    cols,
    viewportRows,
    text: data.text,
    offset,
    startClipped: data.startClipped,
    endClipped: data.endClipped,
    rows,
    osc8,
  };
}
export function linkRanges(
  context: NativeLinkContext,
  start: number,
  end: number,
): NativeLinkRange[] {
  const ranges: NativeLinkRange[] = [];
  for (const row of context.rows) {
    let first = -1;
    for (let i = 0; i <= row.cells.length; i++) {
      const cell = row.cells[i];
      const selected = Boolean(
        cell && cell[0] < end && cell[1] > start && cell[1] > cell[0],
      );
      if (selected && first === -1) first = i;
      if (!selected && first !== -1) {
        ranges.push({
          row: row.row,
          start: row.startCol + first,
          end: row.startCol + i,
        });
        first = -1;
      }
    }
  }
  return ranges;
}
function locationFromHash(hash: string): TerminalFileLocation | undefined {
  const match = hash.match(/^#L(\d+)(?:C(\d+))?$/i);
  if (!match) return undefined;
  return splitTerminalFileLocation(
    `file:${match[1]}${match[2] ? `:${match[2]}` : ""}`,
  ).location;
}
export async function resolveNativeLink(
  context: NativeLinkContext,
  source: NativeLinkSource,
): Promise<ResolvedNativeLink | null> {
  if (context.osc8) {
    const { uri, ranges } = context.osc8;
    const url = safeExternalTerminalUrl(uri);
    if (url) return { target: { kind: "url", url }, ranges };
    if (!/^file:/i.test(uri) || /[\u0000-\u001f\u007f-\u009f]/.test(uri))
      return null;
    try {
      const file = new URL(uri);
      if (
        file.protocol !== "file:" ||
        (file.hostname && file.hostname !== "localhost")
      )
        return null;
      let text = decodeURIComponent(file.pathname);
      if (/^\/[A-Za-z]:\//.test(text)) text = text.slice(1);
      const parsed = splitTerminalFileLocation(text);
      const path = resolveCandidatePath(parsed.text, source.cwd, source.home);
      if (!path || (await source.stat(path))?.kind !== "file") return null;
      const location = locationFromHash(file.hash) ?? parsed.location;
      return {
        target: { kind: "file", path, ...(location ? { location } : {}) },
        ranges,
      };
    } catch {
      return null;
    }
  }
  const url = terminalUrlAt(
    context.text,
    context.offset,
    context.startClipped,
    context.endClipped,
  );
  if (url)
    return {
      target: { kind: "url", url: url.url },
      ranges: linkRanges(context, url.start, url.end),
    };
  const link = await resolveTerminalFileLinkAt({
    line: context.text,
    offset: context.offset,
    cwd: source.cwd,
    home: source.home,
    stat: source.stat,
    startClipped: context.startClipped,
    endClipped: context.endClipped,
  });
  return link
    ? {
        target: {
          kind: "file",
          path: link.path,
          ...(link.location ? { location: link.location } : {}),
        },
        ranges: linkRanges(context, link.start, link.end),
      }
    : null;
}
