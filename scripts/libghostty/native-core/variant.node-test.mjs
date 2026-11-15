import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { artifactName, assertProducer, canonicalProducerPaths, directory, loadBundle, producerToolEnv, validateBundle, verifySDKSelection, verifySource, inspectDeployment, inspectTestSummary } from "./variant.mjs";

test("native core bundle verifies exact checked-in source patch identities", () => {
  const manifest = loadBundle();
  assert.match(artifactName(manifest), /-terax-core1-[a-f0-9]{12}-aarch64-macos\.tar\.gz$/);
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
    }), /invalid native core manifest path/);
  }
});

test("producer resolves source and output parent symlinks before containment", () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "terax-native core-path-")));
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

test("deployment gate rejects the previously observed 13.0 minimum and incomplete members", () => {
  const fixture = (version) => "/tmp/lib.a(a.o):\nLoad command 1\n cmd LC_BUILD_VERSION\n cmdsize 32\n platform 1\n minos " + version + "\n sdk 15.2\n";
  assert.deepEqual(inspectDeployment(fixture("11.0"), ["a.o"]), [{ member: "a.o", minimumMacOS: "11.0" }]);
  assert.throws(() => inspectDeployment(fixture("13.0"), ["a.o"]), /exceeds/);
  assert.throws(() => inspectDeployment(fixture("11.0"), ["a.o", "missing.o"]), /every archive/);
  assert.throws(() => inspectDeployment("/tmp/lib.a(a.o):\n", ["a.o"]), /deployment command/);
});
test("combined focused filter identifies all 23 authored behavior cases", () => {
  const patch = readFileSync(join(directory, "core.patch"), "utf8");
  assert.equal([...patch.matchAll(/^\+test "native core: /gm)].length, 23);
  const config = patch.slice(patch.indexOf("diff --git a/src/build/Config.zig"));
  assert.match(config, /\+            !config.emit_bench and/);
  const producer = readFileSync(join(directory, "produce.mjs"), "utf8");
  assert.match(producer, /-Dtarget=/);
  assert.match(producer, /-Dtest-filter=native core:/);
});

test("focused native evidence rejects skips even when auxiliary passing tests exceed the case count", () => {
  assert.deepEqual(inspectTestSummary("Build Summary: 86/86 tests passed", 23, false), { passed: 86, total: 86 });
  assert.throws(() => inspectTestSummary("Build Summary: 84/86 tests passed; 2 skipped", 23, false), /without skips/);
  assert.throws(() => inspectTestSummary("Build Summary: 86/86 tests passed\nrun test 84 passed 2 skipped", 23, false), /without skips/);
  assert.throws(() => inspectTestSummary("Build Summary: 0/0 tests passed", 23, false), /did not run/);
  assert.throws(() => inspectTestSummary("compile success", 23, false), /missing/);
});
