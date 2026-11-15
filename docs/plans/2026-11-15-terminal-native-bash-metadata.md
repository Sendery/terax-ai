# Bash command metadata boundary

Date: 2026-11-15. Base: `a27ea8f4cce7914b4ec58bd13703c706f25a05dc`.
Worktree: `/Users/andres.rojo/Workspaces/terax-worktrees/native-bash-metadata`.
Branch: `feat/native-terminal-bash-metadata`.

## Result

This is an evidence and regression-test checkpoint, with no production change.
Bash has the same command-boundary and command-text limitations in legacy and
native terminals. Neither history nor host-write timing is accepted as proof of
the command the shell actually accepted. Missing Bash full-command metadata is
an existing capability gap, not a regression introduced by the migration.

The actual installed integration script is
[`bashrc.bash`](../../src-tauri/src/modules/pty/scripts/bashrc.bash).
It uses PS0 on Bash 4.4 and newer and does not install a DEBUG trap on older
Bash. Its modern pre-exec marker has no `cmdline_url`. The legacy
[block parser](../../src/modules/terminal/block/lib/blockDecorations.ts) starts
a block on the same OSC 133 C marker and takes its marker text as the command.
It does not independently recover the complete accepted Bash command.
The native [shell observer](../../src-tauri/src/modules/pty/engine/shell.rs)
authenticates the marker and accepts command text only through a valid
`cmdline_url`.

## Real-shell evidence on M2

Run from this worktree:

```sh
/opt/homebrew/bin/node --test scripts/bash-shell-integration.node-test.mjs
```

All six cases pass, using the real integration rcfile without rewriting it.
Each case accepts ten commands including exit. Only deterministic public
fixtures are used. HOME, history storage and child environment are isolated;
the integration still sources the machine's system profile files as in the
product. Interactive stdin is used, without a PTY or GUI.

| Installed Bash | Mode | Accepted commands | OSC 133 C markers | Command metadata |
| --- | --- | ---: | ---: | ---: |
| macOS 3.2.57 | raw | 10 | 0 | 0 |
| macOS 3.2.57 | native | 10 | 0 | 0 |
| macOS 3.2.57 | native blocks | 10 | 0 | 0 |
| Homebrew 5.3.20 | raw | 10 | 10 | 0 |
| Homebrew 5.3.20 | native | 10 | 10 | 0 |
| Homebrew 5.3.20 | native blocks | 10 | 10 | 0 |

The regression checks require byte-exact, once-only execution of quoted,
multiline, compound, here-document and pipeline commands; preserved exit
status; retained user DEBUG trap; authenticated native markers; unsigned raw
markers; and preservation of an existing user PS0. History storage is zero,
and one accepted list disables history itself. The absence of metadata is
reported diagnostically, not asserted as a permanent product requirement.
A caller can select installed Bash executables with `TERAX_TEST_BASH`
using the platform path delimiter.

Homebrew Bash was installed only as an explicitly authorized development
tool. No login shell, user profile or system shell selection was changed.

## Why no metadata patch

The [GNU Bash manual](https://www.gnu.org/software/bash/manual/bash.html)
describes PS0 as a prompt expanded after reading a command, before execution.
A separate isolated Bash 5.3 probe with history disabled demonstrated that
expanding `BASH_COMMAND` in PS0 returns the previous simple command:
before executing a two-command list, it still contained the prior
`set +o history`. Before the next multiline command, it contained
the last simple command from that list. The variable therefore cannot supply
the complete newly accepted command.

The same manual specifies DEBUG invocation for individual simple commands and
other execution constructs. Installing or chaining such a trap does not
provide the complete original compound input and may change user hook
semantics. Readline interception was not implemented: it would need a separate
design covering custom keymaps, continuation input and older Bash support.
Shell history is also unsuitable when history is disabled, filtered or
normalized. No partial command, stale command or guessed prefix is emitted.

## Remaining scope

An authoritative full-command source for Bash remains a future improvement.
Bash 3.2 command-start support also remains unchanged. This report does not
claim full Bash block parity, a native GUI acceptance run, parser test execution,
or a performance result. Existing Rust parser limits and validation are
unchanged. No Cargo, application build, Actions, push or publication was run.
