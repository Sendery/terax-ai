import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { provisionalPin } from "./provisional.mjs";
import { parseArgs } from "./core.mjs";

const source = JSON.parse(readFileSync(new URL("./source.json", import.meta.url)));
const manifest = JSON.parse(readFileSync(new URL("./provisional.json", import.meta.url)));

test("provisional input is separate from canonical pins and host restricted", () => {
  const original = structuredClone(source);
  const selected = provisionalPin(source, manifest, "aarch64-macos");
  assert.deepEqual(source, original);
  assert.equal(selected.targets["aarch64-macos"].sha256, "fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0");
  assert.notEqual(selected.releaseTag, source.releaseTag);
  assert.throws(() => provisionalPin(source, manifest, "x86_64-macos"), /host/);
});

test("source upgrades, invalid hashes and unsafe archive roots fail closed", () => {
  for (const key of ["commit", "crateVersion", "zigVersion"]) {
    assert.throws(() => provisionalPin({ ...source, [key]: "changed" }, manifest, "aarch64-macos"), /identity/);
  }
  for (const archiveRoot of ["../escape", "/absolute", "a/b", "", ".", "..", "a\\b"]) {
    assert.throws(() => provisionalPin(source, { ...manifest, archiveRoot }, "aarch64-macos"), /root/);
  }
  assert.throws(() => provisionalPin(source, { ...manifest, sha256: null }, "aarch64-macos"), /checksum/);
});

test("provisional mode requires one explicit archive and excludes source mode", () => {
  assert.deepEqual(parseArgs(["--provisional", "core file.tar.gz", "--", "cargo", "test"]), {
    source: false, provisional: "core file.tar.gz", command: ["cargo", "test"],
  });
  for (const flags of [["--provisional"], ["--provisional", "--source"], ["--source", "--provisional", "file"], ["--provisional", "file", "--source"]]) {
    assert.throws(() => parseArgs([...flags, "--", "cargo"]));
  }
});

test("local wrapper verifies bytes, isolates the cache and blocks the Zig compiler", { skip: process.platform !== "darwin" || process.arch !== "arm64" }, () => {
  const root = mkdtempSync(join(tmpdir(), "terax-provisional-"));
  try {
    cpSync(new URL("../with-zig.mjs", import.meta.url), join(root, "scripts/with-zig.mjs"), { recursive: true });
    for (const name of ["core.mjs", "provisional.mjs", "source.json", "pin.json"]) {
      mkdirSync(join(root, "scripts/libghostty"), { recursive: true });
      cpSync(new URL(`./${name}`, import.meta.url), join(root, "scripts/libghostty", name));
    }
    const stage = join(root, "stage", manifest.archiveRoot);
    for (const dir of ["lib", "include/ghostty", "share/pkgconfig"]) mkdirSync(join(stage, dir), { recursive: true });
    writeFileSync(join(stage, "lib/libghostty-vt.a"), "test fixture, not machine code");
    writeFileSync(join(stage, "include/ghostty/vt.h"), "test header");
    writeFileSync(join(stage, "share/pkgconfig/libghostty-vt-static.pc"), "prefix=unused\nName: libghostty-vt-static\nDescription: test fixture\nVersion: 0.1.0\nLibs: -L${prefix}/lib -lghostty-vt\nCflags: -I${prefix}/include\n");
    const archive = join(root, "local core.tar.gz");
    const tar = spawnSync("tar", ["-czf", archive, "-C", join(root, "stage"), manifest.archiveRoot]);
    assert.equal(tar.status, 0, tar.stderr.toString());
    const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(join(root, "scripts/libghostty/provisional.json"), JSON.stringify({ ...manifest, sha256 }));
    const childOutput = join(root, "child.json");
    const script = `const {spawnSync}=require('node:child_process'); const zig=spawnSync('zig',['version'],{encoding:'utf8'}); require('node:fs').writeFileSync(${JSON.stringify(childOutput)}, JSON.stringify({status:zig.status,error:zig.stderr,path:process.env.PKG_CONFIG_PATH}));`;
    const invoke = (env = process.env, archivePath = archive) => spawnSync(process.execPath, [join(root, "scripts/with-zig.mjs"), "--provisional", archivePath, "--", process.execPath, "-e", script], { encoding: "utf8", env });
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    const child = JSON.parse(readFileSync(childOutput));
    assert.equal(child.status, 97);
    assert.match(child.error, /prebuilt mode forbids Zig/);
    assert.ok(child.path.includes("/provisional/"));
    assert.ok(!existsSync(join(root, "src-tauri/target/toolchains", `libghostty-vt-${source.crateVersion}-${source.commit.slice(0, 7)}-aarch64-macos.tar.gz`)));
    rmSync(childOutput);
    assert.equal(invoke().status, 0, "verified cache can be reused");
    rmSync(childOutput);
    const missing = invoke(process.env, join(root, "missing.tar.gz"));
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /ENOENT/);
    assert.ok(!existsSync(childOutput));
    const tools = join(root, "tools");
    mkdirSync(tools);
    writeFileSync(join(tools, "pkg-config"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(tools, "pkg-config"), 0o755);
    const failedProbe = invoke({ ...process.env, PATH: `${tools}${delimiter}${process.env.PATH}` });
    assert.notEqual(failedProbe.status, 0);
    assert.match(failedProbe.stderr, /pkg-config failed/);
    assert.ok(!existsSync(childOutput));
    const conflict = invoke({ ...process.env, GHOSTTY_SOURCE_DIR: root });
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /conflicts with prebuilt/);
    assert.ok(!existsSync(childOutput));
    const library = join(dirname(dirname(child.path)), "lib/libghostty-vt.a");
    const originalLibrary = readFileSync(library);
    writeFileSync(library, "corrupt cache");
    const corruptCache = invoke();
    assert.notEqual(corruptCache.status, 0);
    assert.match(corruptCache.stderr, /cache is corrupt/);
    assert.ok(!existsSync(childOutput));
    writeFileSync(library, originalLibrary);
    writeFileSync(archive, "corrupt archive");
    const corrupt = invoke();
    assert.notEqual(corrupt.status, 0);
    assert.match(corrupt.stderr, /checksum mismatch/);
    assert.ok(!existsSync(childOutput));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
