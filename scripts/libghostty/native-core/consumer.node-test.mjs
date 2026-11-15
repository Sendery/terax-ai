import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseArgs } from "../core.mjs";
import { consumerPin, validatePackage } from "./consumer.mjs";
import { digest, directory, loadBundle } from "./variant.mjs";
function fixture() {
  const manifest = loadBundle();
  const source = { commit: manifest.upstreamCommit, zigVersion: manifest.zigVersion, crateVersion: manifest.crateVersion };
  const header = Buffer.from("reviewed exact core header");
  const bytes = readFileSync(join(directory, "manifest.json"));
  const receipt = { schema: 1, variant: manifest.variant, ...source, host: "aarch64-macos",
    rustTarget: "aarch64-apple-darwin", sha256: "a".repeat(64), patchSha256: manifest.patch.sha256,
    manifestSha256: digest(bytes), terminalHeaderSha256: digest(header), capabilities: manifest.abi,
    minimumMacOS: "11.0", producerTarget: manifest.producerTarget };
  const build = { upstreamCommit: source.commit, variant: manifest.variant, patchSha256: manifest.patch.sha256,
    manifestSha256: receipt.manifestSha256, terminalHeaderSha256: receipt.terminalHeaderSha256,
    zigVersion: source.zigVersion, producerTarget: manifest.producerTarget, target: receipt.rustTarget,
    architectures: "arm64", capabilities: manifest.abi, nativeTestsPassed: true,
    nativeTests: [{ passed: 93, total: 93, skippedAllowed: false }],
    deploymentObjects: [{ member: "vt.o", minimumMacOS: "11.0" }] };
  const read = (path) => path === "build.json" ? Buffer.from(JSON.stringify(build)) :
    path.endsWith("manifest.json") ? bytes : header;
  return { manifest, source, receipt, build, read };
}
test("explicit variant args cannot silently select source or a different archive mode", () => {
  assert.deepEqual(parseArgs(["--variant", "native-core-v1", "--archive", "/tmp/core.tar.gz", "--", "cargo", "check"]),
    { source: false, variant: "native-core-v1", archive: "/tmp/core.tar.gz", command: ["cargo", "check"] });
  for (const flags of [
    ["--variant", "native-core-v1"], ["--variant", "unknown", "--archive", "/tmp/core"],
    ["--variant", "native-core-v1", "--source", "/tmp/core"],
    ["--variant", "native-core-v1", "--archive", "/tmp/core", "--source"],
  ]) assert.throws(() => parseArgs([...flags, "--", "cargo"]), /variant/);
});
test("matching local variant is scoped to its exact native ABI and host", () => {
  const { manifest, source, receipt } = fixture();
  assert.equal(consumerPin(source, manifest, receipt, "aarch64-macos").targets["aarch64-macos"].sha256, receipt.sha256);
  assert.throws(() => consumerPin(source, manifest, receipt, "x86_64-macos"), /host/);
  for (const field of ["patchSha256", "sha256", "producerTarget", "variant"]) {
    assert.throws(() => consumerPin(source, manifest, { ...receipt, [field]: "bad" }, "aarch64-macos"), /identity/);
  }
  assert.throws(() => consumerPin(source, manifest, { ...receipt, capabilities: [manifest.abi[0]] }, "aarch64-macos"), /identity/);
});
test("package identity includes both capabilities, pinned header, real test and deployment evidence", () => {
  const { manifest, receipt, build, read } = fixture();
  assert.doesNotThrow(() => validatePackage(manifest, receipt, read));
  build.deploymentObjects[0].minimumMacOS = "13.0";
  assert.throws(() => validatePackage(manifest, receipt, read), /deployment/);
  build.deploymentObjects[0].minimumMacOS = "11.0.1";
  assert.throws(() => validatePackage(manifest, receipt, read), /deployment/);
  build.deploymentObjects[0].minimumMacOS = "11.0";
  build.nativeTests[0].skippedAllowed = true;
  assert.throws(() => validatePackage(manifest, receipt, read), /focused/);
  build.nativeTests[0].skippedAllowed = false;
  build.capabilities = [];
  assert.throws(() => validatePackage(manifest, receipt, read), /reviewed consumer/);
});
