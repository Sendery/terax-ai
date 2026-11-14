import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isMainModule } from "./cli-entrypoint.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const entrypoints = [
  ["dev-release-config.mjs", 1, "Usage: dev-release-config.mjs"],
  ["release-dev.mjs", 1, "Use a development semver"],
  ["sandbox.mjs", 2, "Usage: sandbox.mjs"],
  ["set-version.mjs", 1, "Usage: pnpm version:set"],
  ["terminal-lab.mjs", 1, "Usage on a clean hosted macOS runner"],
];

describe("cross-platform script entrypoints", () => {
  let root;
  let physical;
  let alias;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "terax-cli # %-"));
    physical = join(root, "physical # %");
    alias = join(root, "alias # %");
    mkdirSync(physical);
    for (const name of [
      ...entrypoints.map(([name]) => name),
      "cli-entrypoint.mjs",
      "terminal-lab-cleanup.mjs",
    ]) {
      copyFileSync(join(scriptDir, name), join(physical, name));
    }
    symlinkSync(physical, alias, process.platform === "win32" ? "junction" : "dir");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe.each([
    ["physical URL-escaped path", false, []],
    ["directory alias", true, []],
    ["preserved directory alias", true, ["--preserve-symlinks-main"]],
  ])("%s", (_label, throughAlias, nodeArgs) => {
    it.each(entrypoints)("runs %s", (name, status, output) => {
      const result = spawnSync(process.execPath, [
        ...nodeArgs,
        join(throughAlias ? alias : physical, name),
      ], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(status);
      expect(`${result.stdout}${result.stderr}`).toContain(output);
    });
  });

  it.each(entrypoints)("imports %s without invoking main when argv has no file", (name) => {
    const url = pathToFileURL(join(alias, name)).href;
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(url)})`,
      "missing-entrypoint.mjs",
    ], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toBe("");
  });

  it("identifies the same file through an alias but rejects another module", () => {
    const argv = [process.execPath, join(alias, "sandbox.mjs")];
    expect(isMainModule(pathToFileURL(join(physical, "sandbox.mjs")).href, argv)).toBe(true);
    expect(isMainModule(pathToFileURL(join(physical, "set-version.mjs")).href, argv)).toBe(false);
    expect(isMainModule(import.meta.url, [process.execPath])).toBe(false);
    expect(isMainModule("data:text/javascript,export{}", argv)).toBe(false);
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
