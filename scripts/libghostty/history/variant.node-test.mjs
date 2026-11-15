import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { artifactName, assertProducer, canonicalProducerPaths, directory, loadBundle, producerToolEnv, validateBundle, verifySDKSelection, verifySource } from "./variant.mjs";

test("history bundle verifies exact checked-in source patch identities", () => {
  const manifest = loadBundle();
  assert.match(artifactName(manifest), /-terax-history1-[a-f0-9]{12}-aarch64-macos\.tar\.gz$/);
  const altered = structuredClone(manifest);
  altered.upstreamCommit = "0".repeat(40);
  assert.throws(() => validateBundle(altered, () => Buffer.alloc(0)), /identity/);
});

test("patch tampering is rejected before source or toolchain mutation", () => {
  const manifest = loadBundle();
  assert.throws(() => validateBundle(manifest, (path) => {
    const bytes = readFileSync(join(directory, path));
    return path === "core.patch" ? Buffer.concat([bytes, Buffer.from("\n")]) : bytes;
  }), /checksum/);
});

test("source hashes distinguish upstream from reviewed patched files", () => {
  const bytes = Buffer.from("upstream");
  const fixture = { files: [{ path: "src/a.zig",
    beforeSha256: "1581e27de87bffae0bd4d745cd7964e68528d7a83e2e4c259a782d275df6f558",
    afterSha256: "0".repeat(64) }] };
  verifySource(fixture, () => bytes, "before");
  assert.throws(() => verifySource(fixture, () => bytes, "after"), /unexpected after/);
  assert.throws(() => verifySource(fixture, () => bytes, "invalid"), /phase/);
});

test("producer rejects implicit and non-M2-target builds", () => {
  assert.throws(() => assertProducer("aarch64-macos", undefined), /explicit/);
  assert.throws(() => assertProducer("x86_64-macos", "1"), /explicit/);
  assert.throws(() => assertProducer("aarch64-linux", "1"), /explicit/);
  assert.doesNotThrow(() => assertProducer("aarch64-macos", "1"));
});

test("unsafe or duplicated manifest paths are rejected", () => {
  const manifest = loadBundle();
  const duplicate = structuredClone(manifest);
  duplicate.files[1].path = duplicate.files[0].path;
  assert.throws(() => validateBundle(duplicate, (path) => readFileSync(join(directory, path))), /duplicate/);
  const escaped = structuredClone(manifest);
  escaped.patch.path = "../core.patch";
  assert.throws(() => validateBundle(escaped, () => Buffer.alloc(0)), /path/);
});

test("dot paths are rejected before any file read", () => {
  for (const path of [".", ".."]) {
    const manifest = structuredClone(loadBundle());
    manifest.patch.path = path;
    assert.throws(() => validateBundle(manifest, () => {
      throw new Error("must not read");
    }), /invalid history manifest path/);
  }
});

test("producer resolves source and output parent symlinks before containment", () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "terax-history-path-")));
  try {
    const source = join(temp, "source");
    mkdirSync(source);
    symlinkSync(source, join(temp, "alias"));
    assert.throws(() => canonicalProducerPaths(source, join(temp, "alias", "output")), /outside/);
    assert.throws(() => canonicalProducerPaths(join(temp, "alias"), join(source, "output")), /outside/);
    assert.deepEqual(canonicalProducerPaths(source, join(temp, "output")),
      { source, output: join(temp, "output") });
    assert.throws(() => canonicalProducerPaths(source, source), /outside/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("producer refuses a selected SDK differing from its verified provenance", () => {
  const selected = { developerDir: "/official/clt", sdkPath: "/official/sdk",
    sdkVersion: "15.2", sdkSettingsSha256: "a".repeat(64), libSystemSha256: "b".repeat(64) };
  assert.doesNotThrow(() => verifySDKSelection(selected, { ...selected }));
  assert.throws(() => verifySDKSelection(selected, { ...selected, sdkVersion: "27.0" }), /sdkVersion/);
  assert.throws(() => verifySDKSelection(selected, { ...selected, libSystemSha256: "c".repeat(64) }), /libSystem/);
});

test("producer keeps system tool precedence and verified developer identity", () => {
  const original = { PATH: ["/candidate/tools", "/bin", "/opt/homebrew/bin", "/usr/bin"].join(delimiter),
    DEVELOPER_DIR: "/official/verified/CommandLineTools", MARKER: "preserved" };
  const env = producerToolEnv(original);
  assert.deepEqual(env.PATH.split(delimiter).slice(0, 2), ["/usr/bin", "/bin"]);
  assert.equal(env.DEVELOPER_DIR, original.DEVELOPER_DIR);
  assert.equal(env.MARKER, "preserved");
  assert.equal(original.PATH.split(delimiter)[0], "/candidate/tools");
  if (process.platform === "darwin") {
    const resolved = spawnSync("/usr/bin/which", ["xcrun"], { env, encoding: "utf8" });
    assert.equal(resolved.status, 0);
    assert.equal(resolved.stdout.trim(), "/usr/bin/xcrun");
  }
});
