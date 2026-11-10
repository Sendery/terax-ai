import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSION_FILES } from "./set-version.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "set-version.mjs");

function seedProject(root) {
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  mkdirSync(join(root, "packages", "pi-terax"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "terax", version: "0.0.1" }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify({ version: "0.0.1" }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.toml"),
    '[package]\nname = "terax"\nversion = "0.0.1"\n',
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.lock"),
    '[[package]]\nname = "terax"\nversion = "0.0.1"\n',
  );
  writeFileSync(
    join(root, "packages", "pi-terax", "package.json"),
    `${JSON.stringify({ name: "@crynta/pi-terax", version: "0.0.1" }, null, 2)}\n`,
  );
}

function runSetVersion(root, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function readJson(root, relative) {
  return JSON.parse(readFileSync(join(root, relative), "utf8"));
}

describe("set-version version lockstep", () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "terax-set-version-"));
    seedProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("bumps every version in lockstep and preserves %s endings", (_label, eol) => {
    for (const file of VERSION_FILES) {
      const path = join(root, file);
      writeFileSync(path, readFileSync(path, "utf8").replace(/\r?\n/g, eol));
    }
    const result = runSetVersion(root, ["1.2.3"]);
    expect(result.status).toBe(0);
    expect(readJson(root, "package.json").version).toBe("1.2.3");
    expect(readJson(root, "packages/pi-terax/package.json").version).toBe("1.2.3");
    expect(readJson(root, "src-tauri/tauri.conf.json").version).toBe("1.2.3");
    for (const file of VERSION_FILES) {
      const content = readFileSync(join(root, file), "utf8");
      expect(content).toContain('"1.2.3"');
      expect(content).not.toContain('"0.0.1"');
      expect(content).toBe(content.replace(/\r?\n/g, eol));
    }
  });

  it("restores every versioned file after a versioned build", () => {
    // A build that leaves any versioned file dirty breaks the next release
    // staging run, which requires a completely clean working tree.
    const buildVersion = readFileSync(join(scriptDir, "build-version.mjs"), "utf8");
    expect(VERSION_FILES).toContain("packages/pi-terax/package.json");
    expect(buildVersion).toContain("VERSION_FILES");
    for (const file of VERSION_FILES) {
      expect(buildVersion).not.toMatch(
        new RegExp(`^\\s*"${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",`, "m"),
      );
    }
  });

  it("leaves files untouched on a dry run", () => {
    const result = runSetVersion(root, ["1.2.3", "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("would update packages/pi-terax/package.json");
    expect(readJson(root, "packages/pi-terax/package.json").version).toBe("0.0.1");
  });
});
