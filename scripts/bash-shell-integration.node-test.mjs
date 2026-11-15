import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rcfile = fileURLToPath(new URL("../src-tauri/src/modules/pty/scripts/bashrc.bash", import.meta.url));
const shells = process.env.TERAX_TEST_BASH
  ? process.env.TERAX_TEST_BASH.split(delimiter)
  : ["/bin/bash", "/opt/homebrew/bin/bash"].filter(existsSync);
const fixtureAid = "public-shell-integration-fixture";
const commands = [
  "printf '%s\\n' 'quoted ; dollar $ and \"double quotes\"' >> \"$HOME/result\"",
  "printf '%s\\n' 'line one\nline two' >> \"$HOME/result\"",
  "if true; then printf '%s\\n' 'compound' >> \"$HOME/result\"; fi",
  "cat <<'TERAX_PUBLIC_END' >> \"$HOME/result\"\nheredoc $literal\nTERAX_PUBLIC_END",
  "printf '%s\\n' 'pipeline' | tr a-z A-Z >> \"$HOME/result\"",
  " set +o history; printf '%s\\n' 'history disabled' >> \"$HOME/result\"",
  "false",
  "printf '%s\\n' \"$?\" > \"$HOME/status\"",
  "trap -p DEBUG > \"$HOME/trap-after\"",
];
const expectedResult = [
  'quoted ; dollar $ and "double quotes"',
  "line one", "line two", "compound", "heredoc $literal", "PIPELINE", "history disabled", "",
].join("\n");

for (const shell of shells) {
  for (const mode of ["raw", "native", "native-blocks"]) {
    test(shell + " integration preserves command execution and user hooks (" + mode + ")", {
      skip: process.platform === "win32" ? "Installed Unix Bash required" : false,
    }, (t) => {
      const home = mkdtempSync(join(tmpdir(), "terax-public-bash-"));
      try {
        // Do not inherit developer credentials, shell startup paths, or history.
        const env = {
          HOME: home, PATH: "/usr/bin:/bin", TERM: "dumb", LC_ALL: "C",
          HISTFILE: "/dev/null", HISTCONTROL: "ignorespace", HISTSIZE: "0",
          ...(mode === "raw" ? {} : { TERAX_SHELL_INTEGRATION_TOKEN: fixtureAid }),
          ...(mode === "native-blocks" ? { TERAX_BLOCKS: "1" } : {}),
        };
        const version = spawnSync(shell, ["--noprofile", "--norc", "-c", 'printf "%s" "$BASH_VERSION"'], {
          env, encoding: "utf8", timeout: 10_000,
        });
        assert.equal(version.error, undefined, "Bash version process failed");
        assert.equal(version.status, 0, "Bash version process failed");
        const [major, minor] = version.stdout.split(".").map(Number);
        const supportsPs0 = major > 4 || (major === 4 && minor >= 4);
        writeFileSync(join(home, ".bashrc"), [
          "PS1='public prompt> '",
          "PS2='public continued> '",
          "PS0='PUBLIC_PS0'",
          "_terax_fixture_debug() { printf x >> \"$HOME/debug-log\"; }",
          "trap _terax_fixture_debug DEBUG",
          "trap -p DEBUG > \"$HOME/trap-before\"",
          "",
        ].join("\n"));
        // Interactive stdin exercises PS0 after the complete command has been
        // read, including quoted newlines and a here-document. No PTY/UI claim.
        const result = spawnSync(shell, ["--noprofile", "--rcfile", rcfile, "-i"], {
          cwd: home, env, input: commands.join("\n") + "\nexit\n",
          encoding: "utf8", timeout: 15_000, maxBuffer: 1_048_576,
        });
        assert.equal(result.error, undefined, "Interactive Bash process failed");
        assert.equal(result.status, 0, "Interactive Bash process failed");
        assert.equal(readFileSync(join(home, "result"), "utf8"), expectedResult,
          "Accepted commands must execute exactly once with their original quoting");
        assert.equal(readFileSync(join(home, "status"), "utf8"), "1\n",
          "The prompt integration must preserve the previous command status");
        assert.equal(readFileSync(join(home, "trap-after"), "utf8"),
          readFileSync(join(home, "trap-before"), "utf8"), "The user DEBUG trap must remain installed");
        assert.ok(readFileSync(join(home, "debug-log")).length > 0, "The user DEBUG trap must still run");

        const output = result.stdout + result.stderr;
        const markers = [...output.matchAll(/\x1b\]133;([ABCD])([^\x1b\x07]*)(?:\x1b\\|\x07)/g)];
        assert.ok(markers.some((m) => m[1] === "B"), "The real integration must emit a prompt");
        assert.ok(markers.some((m) => m[1] === "D" && m[2].split(";")[1] === "1"),
          "The real integration must emit the failing exit status");
        for (const marker of markers) {
          const origins = marker[2].split(";").filter((part) => part.startsWith("aid="));
          assert.deepEqual(origins, mode === "raw" ? [] : ["aid=" + fixtureAid],
            "Every shell marker must retain its original raw/native origin");
        }
        const starts = markers.filter((m) => m[1] === "C");
        if (supportsPs0) {
          assert.equal(starts.length, commands.length + 1,
            "One pre-exec boundary is emitted for each complete accepted command, including exit");
          assert.equal(output.split("PUBLIC_PS0").length - 1, commands.length + 1,
            "The existing user PS0 must be preserved");
        }
        // Missing metadata is a diagnostic, not a required permanent limitation.
        const metadata = starts.filter((m) => m[2].includes(";cmdline_url="));
        t.diagnostic("Bash " + version.stdout + "; " + mode + "; accepted=" + (commands.length + 1)
          + "; starts=" + starts.length + "; command-metadata=" + metadata.length);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  }
}
