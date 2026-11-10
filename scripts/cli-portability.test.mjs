import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const entrypoints = [
  ["dev-release-config.mjs", 1, "Usage: dev-release-config.mjs"],
  ["release-dev.mjs", 1, "Use a development semver"],
  ["sandbox.mjs", 2, "Usage: sandbox.mjs"],
  ["set-version.mjs", 1, "Usage: pnpm version:set"],
];

describe("cross-platform script entrypoints", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "terax-cli # %-"));
    for (const [name] of entrypoints) {
      copyFileSync(join(scriptDir, name), join(root, name));
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each(entrypoints)("runs %s from a path containing URL escapes", (name, status, output) => {
    const result = spawnSync(process.execPath, [join(root, name)], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status);
    expect(`${result.stdout}${result.stderr}`).toContain(output);
  });
});

it("keeps script shebangs LF even with Windows checkout conversion enabled", () => {
  const paths = [
    ...entrypoints.map(([name]) => `scripts/${name}`),
    "scripts/release-dev-macos.sh",
  ];
  const result = spawnSync("git", ["-c", "core.autocrlf=true", "check-attr", "eol", "--stdin"], {
    cwd: dirname(scriptDir),
    input: `${paths.join("\n")}\n`,
    encoding: "utf8",
    timeout: 10_000,
  });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split(/\r?\n/)).toEqual(
    paths.map((path) => `${path}: eol: lf`),
  );
});
