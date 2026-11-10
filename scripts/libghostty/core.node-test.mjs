import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { hostTriple, parseArgs, selectedTarget, verifyChecksum, prebuiltEnv, assertVendoredPkgConfig } from "./core.mjs";
const pin = { targets: { "x86_64-linux": { rustTarget: "x86_64-unknown-linux-gnu", sha256: "a".repeat(64) } } };
test("host names and unsupported architectures", () => {
  assert.equal(hostTriple("darwin", "arm64"), "aarch64-macos");
  assert.equal(hostTriple("win32", "x64"), "x86_64-windows");
  assert.equal(hostTriple("linux", "riscv64"), null);
});
test("source is explicit and arguments are preserved", () => {
  assert.deepEqual(parseArgs(["--", "cargo", "test"]), { source: false, command: ["cargo", "test"] });
  assert.equal(parseArgs(["--source", "--", "cargo"]).source, true);
  assert.throws(() => parseArgs(["--bad", "--", "cargo"]));
  assert.throws(() => parseArgs(["--"]));
});
test("missing pins and cross targets fail closed", () => {
  assert.equal(selectedTarget(pin, "x86_64-linux").rustTarget, "x86_64-unknown-linux-gnu");
  assert.throws(() => selectedTarget(pin, "aarch64-macos"));
  assert.throws(() => selectedTarget({ targets: { "x86_64-linux": { sha256: null } } }, "x86_64-linux"));
  assert.throws(() => selectedTarget(pin, "x86_64-linux", {}, ["--target=x86_64-unknown-linux-musl"]));
  assert.throws(() => selectedTarget(pin, "x86_64-linux", { CARGO_BUILD_TARGET: "aarch64-apple-darwin" }));
});
test("corruption is fatal", () => {
  const bytes = Buffer.from("artifact");
  verifyChecksum(bytes, createHash("sha256").update(bytes).digest("hex"));
  assert.throws(() => verifyChecksum(bytes, "0".repeat(64)));
});
test("prebuilt environment blocks source overrides and sanitizes pkg-config", () => {
  assert.throws(() => prebuiltEnv({ GHOSTTY_SOURCE_DIR: "checkout" }, "target", "/pc", "pkg-config"));
  assert.throws(() => prebuiltEnv({ DOCS_RS: "1" }, "target", "/pc", "pkg-config"));
  const env = prebuiltEnv({ PKG_CONFIG_LIBDIR: "/wrong", LIBGHOSTTY_VT_STATIC_NO_PKG_CONFIG: "1", PATH: "/bin" }, "target", "/pc", "pkg-config");
  assert.equal(env.PKG_CONFIG_LIBDIR, "/wrong");
  assert.equal(env.LIBGHOSTTY_VT_STATIC_NO_PKG_CONFIG, undefined);
  assert.equal(env.PKG_CONFIG_PATH, "/pc");
  assert.equal(env.PATH, "/bin");
});

test("manifest pins match the Cargo crate versions", () => {
  const source = JSON.parse(readFileSync(new URL("./source.json", import.meta.url)));
  const cargo = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
  for (const crate of ["libghostty-vt", "libghostty-vt-sys"]) {
    assert.ok(cargo.includes(`${crate} = { version = "=${source.crateVersion}"`));
  }
  assert.match(source.commit, /^[a-f0-9]{40}$/);
});

for (const [label, newline] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  test(`empty private dependency fields stay on their own lines (${label})`, () => {
    for (const lines of [
      ["Libs.private: ", "Requires.private: ", "Cflags: -I${includedir}"],
      ["Libs.private:\t ", "", "Requires.private:\t", "", "Version: 1.0"],
      ["Libs.private:", "Name: libghostty-vt-static", "Requires.private:"],
    ]) assert.doesNotThrow(() => assertVendoredPkgConfig(lines.join(newline)));
  });
  test(`actual private dependencies are rejected (${label})`, () => {
    for (const field of ["Libs.private: -lc++", "Requires.private:\tsimdutf", "Requires.private: simdutf >= 1.0", "Libs.private: \\"]) {
      const pc = ["Libs: ${libdir}/libghostty-vt.a", "", field, "", "Cflags: -I${includedir}"].join(newline);
      assert.throws(() => assertVendoredPkgConfig(pc), /unexpected non-vendored private dependency/);
    }
  });
}
