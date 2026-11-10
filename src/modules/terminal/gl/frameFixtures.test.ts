import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { decodeFrame } from "@/modules/terminal/gl/frameCodec";
import { describeFrame } from "@/modules/terminal/gl/frameCodec.testing";
import { describe, expect, it } from "vitest";

// The Rust encoder writes these (UPDATE_FIXTURES=1 in its frame tests). Until
// it has, the directory is absent and there is nothing to compare.
const DIR = path.resolve(
  __dirname,
  "../../../../tests/fixtures/terminal-frames",
);

const names = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((file) => file.endsWith(".frame"))
      .map((file) => file.slice(0, -".frame".length))
      .sort()
  : [];

function readAligned(file: string): ArrayBuffer {
  const bytes = readFileSync(file);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

// The contract spells the fifth cursor style only as "hollow block", so the
// spelling is compared without case or separators.
function normalizeCursorStyle(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const cursor = record.cursor as Record<string, unknown> | undefined;
  if (!cursor || typeof cursor.style !== "string") return value;
  return {
    ...record,
    cursor: {
      ...cursor,
      style: cursor.style.toLowerCase().replace(/[^a-z]/g, ""),
    },
  };
}

describe("terminal frame fixtures", () => {
  it.skipIf(names.length > 0)(
    "has no fixtures yet, so there is nothing to compare",
    () => {
      expect(names).toEqual([]);
    },
  );

  it.each(names)("%s decodes to its description", (name) => {
    const frame = decodeFrame(readAligned(path.join(DIR, `${name}.frame`)));
    const expected = JSON.parse(
      readFileSync(path.join(DIR, `${name}.json`), "utf8"),
    );
    expect(normalizeCursorStyle(describeFrame(frame))).toEqual(
      normalizeCursorStyle(expected),
    );
  });
});
