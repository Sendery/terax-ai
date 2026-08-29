import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMAND_IDS, PI_ALLOWED_COMMAND_IDS } from "./registry";

const repoRoot = new URL("../../../../", import.meta.url);

function idsBetween(path: string, startMarker: string, endMarker: string) {
  const source = readFileSync(new URL(path, repoRoot), "utf8");
  const start = source.indexOf(startMarker);
  expect(start, `${startMarker} not found in ${path}`).toBeGreaterThan(-1);
  const body = source.slice(start);
  const block = body.slice(0, body.indexOf(endMarker));
  return (block.match(/"[a-z][a-zA-Z-]*(?:\.[a-zA-Z]+)+"/g) ?? []).map((id) =>
    id.slice(1, -1),
  );
}

describe("Pi command allowlist parity", () => {
  // The id list is written out three times: the frontend registry that
  // executes it, the extension that offers it to Pi, and the Rust bridge that
  // gates the socket. Nothing but this test stops them from drifting, and a
  // command missing from any one layer is dead on arrival.
  it("matches the extension package", () => {
    const extension = idsBetween(
      "packages/pi-terax/src/commands.ts",
      "export const TERAX_COMMAND_IDS",
      "] as const;",
    );

    expect(extension).toEqual([...COMMAND_IDS]);
  });

  it("matches the Rust bridge allowlist", () => {
    const rust = idsBetween(
      "src-tauri/src/modules/pi.rs",
      "fn is_allowed_command",
      "\n}",
    );

    expect([...rust].sort()).toEqual([...COMMAND_IDS].sort());
  });

  it("offers every registry command to Pi", () => {
    expect(PI_ALLOWED_COMMAND_IDS).toEqual([...COMMAND_IDS]);
  });
});
