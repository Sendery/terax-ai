import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateLicenseBundle, writeLicenseBundle } from "./licenses.mjs";
import { verifyChecksum } from "./core.mjs";

const bytes = Buffer.from("copyright and permission notice\r\n");
const hash = createHash("sha256").update(bytes).digest("hex");
const pin = { commit: "a".repeat(40), zigVersion: "0.15.2" };
function fixture() {
  return { ghosttyCommit: pin.commit, zigVersion: pin.zigVersion, files: [{ path: "nested/LICENSE", sha256: hash }], sourceChecks: [{ path: "vendor/header.h", sha256: hash }] };
}
test("verified offline license bundle accepts exact source and notice bytes", () => {
  assert.doesNotThrow(() => validateLicenseBundle(pin, fixture(), () => bytes, () => bytes));
});
test("source or Zig upgrades require renewed license review", () => {
  for (const changed of [{ ...pin, commit: "b".repeat(40) }, { ...pin, zigVersion: "0.16.0" }]) {
    assert.throws(() => validateLicenseBundle(changed, fixture(), () => bytes, () => bytes), /review and repin/);
  }
});
test("corrupt notices and modified vendored inputs fail", () => {
  assert.throws(() => validateLicenseBundle(pin, fixture(), () => Buffer.from("corrupt"), () => bytes), /checksum mismatch/);
  assert.throws(() => validateLicenseBundle(pin, fixture(), () => bytes, () => Buffer.from("modified")), /checksum mismatch/);
});
test("missing notices and source files fail", () => {
  const missing = () => { throw new Error("missing file"); };
  assert.throws(() => validateLicenseBundle(pin, fixture(), missing, () => bytes), /missing file/);
  assert.throws(() => validateLicenseBundle(pin, fixture(), () => bytes, missing), /missing file/);
});
test("unsafe manifest paths are rejected before reading files", () => {
  for (const path of ["../LICENSE", "/LICENSE", "a/../../LICENSE", "C:/LICENSE", "a\\LICENSE", ""]) {
    const manifest = fixture(); manifest.files[0].path = path;
    assert.throws(() => validateLicenseBundle(pin, manifest, () => assert.fail("must not read"), () => bytes), /invalid license manifest path/);
  }
});
test("empty and duplicate manifests are rejected", () => {
  assert.throws(() => validateLicenseBundle(pin, { ...fixture(), files: [] }, () => bytes, () => bytes), /empty license manifest/);
  const manifest = fixture(); manifest.files.push({ ...manifest.files[0] });
  assert.throws(() => validateLicenseBundle(pin, manifest, () => bytes, () => bytes), /duplicate/);
});
test("checked-in notices retain their pinned checksums and reviewed versions", () => {
  const manifest = JSON.parse(readFileSync(new URL("./licenses/manifest.json", import.meta.url)));
  const source = JSON.parse(readFileSync(new URL("./source.json", import.meta.url)));
  assert.equal(manifest.ghosttyCommit, source.commit);
  assert.equal(manifest.zigVersion, source.zigVersion);
  for (const entry of manifest.files) verifyChecksum(readFileSync(new URL(`./licenses/${entry.path}`, import.meta.url)), entry.sha256);
  for (const path of ["uucode/LICENSE.md", "upstream-supplements/uucode-LICENSE_unicode", "upstream-supplements/uucode-LICENSE_Bjoern_Hoehrmann", "upstream-supplements/simdutf-LICENSE-MIT", "upstream-supplements/simdutf-LICENSE-APACHE", "simdutf-embedded-notices.txt", "highway/LICENSE", "compiler-rt-attribution.txt"]) {
    assert.ok(manifest.files.some((entry) => entry.path === path), path);
  }
});
test("packaging preserves exact notice and manifest bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghostty-notices-"));
  try {
    const manifestBytes = Buffer.from(JSON.stringify(fixture()));
    writeLicenseBundle({ manifestBytes, contents: new Map([["nested/LICENSE", bytes]]) }, dir);
    assert.deepEqual(readFileSync(join(dir, "nested/LICENSE")), bytes);
    assert.deepEqual(readFileSync(join(dir, "manifest.json")), manifestBytes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("license bytes survive checkout with core.autocrlf enabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghostty-notice-checkout-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  try {
    git("init", "--quiet");
    git("config", "core.autocrlf", "true");
    mkdirSync(join(dir, "licenses"));
    writeFileSync(join(dir, "licenses/.gitattributes"), readFileSync(new URL("./licenses/.gitattributes", import.meta.url)));
    const original = Buffer.from("Copyright\nPermission notice\n");
    writeFileSync(join(dir, "licenses/LICENSE"), original);
    git("add", "licenses");
    rmSync(join(dir, "licenses/LICENSE"));
    git("checkout-index", "--force", "--", "licenses/LICENSE");
    assert.deepEqual(readFileSync(join(dir, "licenses/LICENSE")), original);
    assert.match(git("check-attr", "text", "--", "licenses/LICENSE").toString(), /text: unset/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
