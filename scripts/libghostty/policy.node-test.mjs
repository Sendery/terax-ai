import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("the actual Cargo build script rejects fallback before any git or Zig process", { skip: process.platform === "win32" ? "Unix process spies require macOS or Linux" : false }, () => {
  const root = mkdtempSync(join(tmpdir(), "terax-build-policy-"));
  try {
    const marker = join(root, "producer-started");
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const name of ["git", "zig", "pkg-config"]) {
      const script = name === "pkg-config" ? "#!/bin/sh\nexit 1\n" : `#!/bin/sh\nprintf '%s' '${name}' > '${marker}'\nexit 90\n`;
      writeFileSync(join(bin, name), script);
      chmodSync(join(bin, name), 0o755);
    }
    const build = fileURLToPath(new URL("../../src-tauri/vendor/libghostty-vt-sys/build.rs", import.meta.url));
    writeFileSync(join(root, "Cargo.toml"), `[package]\nname="terax-ghostty-build-policy-probe"\nversion="0.0.0"\nedition="2024"\nbuild=${JSON.stringify(build)}\n[workspace]\n[lib]\npath="lib.rs"\n[features]\ndefault=["pkg-config"]\npkg-config=[]\nlink-dynamic=[]\n[build-dependencies]\npkg-config="0.3"\n`);
    writeFileSync(join(root, "lib.rs"), "");
    const invoke = (optIn, sourceOverride = false) => {
      const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, CARGO_TARGET_DIR: join(root, "target"), PKG_CONFIG: join(bin, "pkg-config") };
      for (const key of Object.keys(env)) {
        if (/^(?:HOST_|TARGET_)?PKG_CONFIG_/.test(key) || key.startsWith("LIBGHOSTTY_VT_STATIC_") || ["DOCS_RS", "GHOSTTY_SOURCE_DIR", "GHOSTTY_ZIG_SYSTEM_DIR", "TERAX_GHOSTTY_SOURCE_BUILD"].includes(key)) delete env[key];
      }
      if (optIn !== undefined) env.TERAX_GHOSTTY_SOURCE_BUILD = optIn;
      if (sourceOverride) env.GHOSTTY_SOURCE_DIR = root;
      return spawnSync("cargo", ["check", "--offline", "--manifest-path", join(root, "Cargo.toml")], { env, encoding: "utf8", timeout: 120_000 });
    };
    for (const optIn of [undefined, "", "0", "true"]) {
      for (const sourceOverride of [false, true]) {
        const result = invoke(optIn, sourceOverride);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /source fallback is disabled/);
        assert.ok(!existsSync(marker), `producer started for ${String(optIn)}, override=${sourceOverride}`);
      }
    }
    const explicit = invoke("1");
    assert.notEqual(explicit.status, 0);
    assert.ok(existsSync(marker), explicit.stderr);
    assert.equal(readFileSync(marker, "utf8"), "git");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
