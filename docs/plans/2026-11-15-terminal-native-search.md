# Native search in ordinary terminal panes

The normal native terminal now supports header search over its full retained
history. Incremental literal Unicode search, overlapping matches, forward and
backward navigation, active/all highlights, clearing and focus restoration use
the native core. This is an explicit sandbox opt-in migration slice. The full
terminal replacement objective remains active.

## Behavior

The shared TerminalSearch contract accepts the existing legacy addon through a
stable adapter and native asynchronous queries without pretending to implement
SearchAddon. Adjacent unsent incremental input coalesces; explicit navigation
and clear keep order. Adapters bind to a process generation, so late replies or
old clear actions cannot affect a replacement. Healthy exited terminals retain
search until close.

Search reads native retained rows, independent of the viewport and the 1000-line
text-tail API. Soft wraps join, hard line breaks remain boundaries, and native
grapheme/wide cells map Unicode byte matches to coordinates. Contextual Greek
lowercase uses joined text; sigma queries retain full logical-line context.
Only active endpoints are tracked core references. Search never changes the
user's selection. Empty search avoids history work and overlay allocations.
The input accepts at most 4096 UTF-8 bytes without controls; the on-demand index
has a 64 MiB cap. Text, selection and search share 32-request actor admission.
The IPC receipt timeout is 10 seconds; it does not cancel already accepted work.

The compact header now refocuses an already open field on Cmd+F. The literal
field disables corrections/suggestions; the observed single-Escape behavior is
verified without attributing a specific internal macOS mechanism. Asynchronous
errors belong only to the current target and never escape as rejected promises.

## Verification

Work ran exclusively on M2, in the isolated worktree
/Users/andres.rojo/Workspaces/terax-worktrees/native-search, branch
feat/native-terminal-search, based on e46619e. The original checkout's unrelated
pending plan edit remains unchanged. Builds used the verified provisional
prebuilt archive with source fallback denied; no Zig build on the protected Mac,
GitHub Actions, push or merge was performed.

The full floor passed, with only affected checks repeated after review changes:

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
pnpm --dir packages/pi-terax test
node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked --features ghostty-engine -- -D warnings
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --locked --features ghostty-engine
git diff --check
```

Native commands used explicit --target-dir pointing at the original M2 Cargo
cache, sequentially with its dev watcher stopped. Source, frontend dependencies,
prebuilt extraction and Node subprocess cwd remained in the isolated worktree.
Frontend: 2423 passed, one existing skip. Pi: 101. Node: 43. Plain Rust: 595 unit
and 58 integration passed, one ignored. Native Rust: 688 unit and 58 integration
passed, two ignored. No checks, rules or assertions were suppressed.

Tests cover history before the last 1000 rows, both directions/wraparound,
overlapping matches, Unicode expansion and contextual casing, combining/wide
cells, soft/hard wraps, erased anchors, reflow, alternate screen, independent
selection, shared admission, post-exit frames/clear and late close/respawn replies.
Independent review found the initial sigma gap and missing in-flight lifecycle
coverage; both were corrected before acceptance. Final review was code and
metadata only. An automatic review rejected the reviewer's complete-PNG export
for possible private content; the reviewer did not try another export path.
Root inspected the authorized sandbox images already available and color-only
metadata, without needing that export.

Real ordinary-window evidence on M2 proves Cmd+F, incremental highlights, Enter
and Shift+Enter across 1250 retained output rows, one Escape back to shell input,
compact refocus, split/reflow, distinct shell PIDs and preservation of the
original shell PID. The six non-diagnostic captures are:

- .terax/visual-qa/20261115T031426.139Z-native-search-final-recent-3KqHko/screenshot.png
- .terax/visual-qa/20261115T031427.221Z-native-search-final-past-8KkXVn/screenshot.png
- .terax/visual-qa/20261115T031428.302Z-native-search-final-previous-saacnw/screenshot.png
- .terax/visual-qa/20261115T031430.851Z-native-search-final-overlap-JuS0k5/screenshot.png
- .terax/visual-qa/20261115T031435.346Z-native-search-final-split-reflow-PrJ0mQ/screenshot.png
- .terax/visual-qa/20261115T031437.178Z-native-search-final-cleared-XQ3SEU/screenshot.png

Past, overlap, split and cleared PNGs were inspected. The suspected missing
active span in split was a mistaken visual interpretation: the original and
later diagnostic capture each contain 1381 amber pixels and 7871 gray match
pixels in the left pane. Metadata confirmed matching active endpoints. All
temporary source diagnostics were removed; no renderer change was justified.
The app build provenance for this run is base e46619e plus this reviewed source
diff. Public fixtures, structural/OS assertions, failed attempts and exact logs
are retained under .terax/pi-development/normal-search and m2/logs on M2.

## Remaining migration

Links, blocks, selection-action consumers, remaining settings, TUI mouse/readline
behavior, complete grapheme rendering, graphics/images, mixed-DPI behavior,
agent/task/restore acceptance, Windows/Linux runtime checks and rollout/soak
remain open. A correct native search does not prove those capabilities. FPS is
an optional optimization; no further performance laboratories were run.
