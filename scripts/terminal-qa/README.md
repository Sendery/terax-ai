# Terminal text fidelity QA

Tools for the scenarios in `docs/plans/2026-11-21-terminal-text-fidelity.md`.

## Capture what a program writes

`capture.py` runs a program in a pseudo-terminal, applies a script of waits,
keystrokes and resizes (with SIGWINCH), and saves every output chunk and
resize as JSON. It answers the cursor-position and device-attribute queries
so TUIs do not stall.

```sh
python3 scripts/terminal-qa/capture.py /tmp/zsh.json '{
  "size": [80, 24], "cwd": "/tmp", "argv": ["zsh", "-i"],
  "steps": [["wait", 3], ["type", "cat sample.txt\r", 2],
            ["resize", 50, 24, 1.5], ["resize", 120, 24, 1.5]]
}'
```

Do not script prompts into agent CLIs: anything submitted reaches the model.
For Claude Code, accept the trust dialog with `\u001b[B` and `\r` and stop
there, or print history before it with `sh -c '...; exec claude'`.

## Replay it into the engine

The ignored test `fidelity_tests::replay_capture` feeds a capture through the
same erase-line filter as the engine, applies its resizes, and reports how
many times each marker survives in the history.

```sh
cd src-tauri
TERAX_REPLAY=/tmp/zsh.json TERAX_REPLAY_MARKERS="sentence,prompt" \
TERAX_REPLAY_COPY=1 TERAX_REPLAY_DUMP=1 \
node ../scripts/with-zig.mjs --variant native-core-v1 --archive <core.tar.gz> -- \
  cargo test --features ghostty-engine --lib fidelity_tests::replay_capture -- --ignored --nocapture
```

Options: `TERAX_REPLAY_RAW` (skip the filter), `TERAX_REPLAY_NO_REFLOW`,
`TERAX_REPLAY_CLEAR` (erase the screen before each resize), and
`TERAX_REPLAY_COPY_EACH` (print Select All before each resize).

For the signed shell prompt redraw path, run the following on the QA host
from this worktree. The capture uses isolated shell profiles with a long
two-line prompt, prints sample output, types an unfinished command, and
resizes nine times.

```sh
bash scripts/terminal-qa/capture-shell-resize.sh /tmp/terax-resize-captures
TERAX_REPLAY=/tmp/terax-resize-captures/zsh.json \
TERAX_REPLAY_MARKERS='short line,long sentence that keeps going,echo second command' \
ghostty_cargo test --features ghostty-engine --lib \
  prompt_redraw_tests::replay_capture_through_prompt_redraw -- --ignored --nocapture
```

Run the replay again with `bash.json`. Expect each marker once in Select All
and the current prompt intact. The `fidelity_tests::replay_capture` run gives
the comparison without the signed prompt redraw handling.
