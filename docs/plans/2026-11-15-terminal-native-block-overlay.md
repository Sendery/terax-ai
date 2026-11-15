# Native terminal block overlay integration

New ordinary and blocks panes can use libghostty-vt through the existing explicit development flag. Native blocks now mount the shared block controls and watermark, with independent CodeMirror drafts and direct native input while a foreground program runs. Normal builds remain on xterm.js until full functional parity is verified.

## Behavior and ownership

NativeBlockView is owned by one EngineSession. It binds immutable presented-frame geometry, explicit bounded output reads, scoped search and revisioned native match anchors. Showing a previously hidden pane re-presents its actual drawn sequence even when that sequence did not advance. Session replacement disposes projection/input subscriptions and invalidates async UI callbacks.

BlockOverlay accepts both synchronous legacy and asynchronous native sources. Search coalesces one in-flight request and the latest query; late or disposed results cannot publish. Navigation awaits native Reveal. Missing output is reported as unavailable, separately from real empty output. Copy begins in the WebKit user gesture with a promised payload, and success follows acknowledged write. Private AI attachment is hidden and revalidated after a read. No output-body cache, new dependency, persistence schema, Pi command or MCP exposure is added.

Menu/search focus is guarded by current owner and visibility. Find opens after Radix closes its modal focus scope, repeated Find focuses the existing field, and close/Escape restores the owning editor after React removes search. Native pointer/key handlers attach to the grid host rather than sibling controls. Delayed click selection checks both gesture generation and EngineSession selection revision.

The existing screenshot path now composites bounded frozen visible foreground DOM above required native canvas crops, respecting original ancestor overflow clipping. It freezes foreground state before asynchronous font/image loading. Capture target allowlists and private guards are unchanged. No desktop or OS screenshot path is added.

## Change matrix

| Area | Status |
| --- | --- |
| Native and legacy block UI adapters | Implemented |
| Draft ownership, mode routing, block navigation | Implemented and exercised on M2 |
| Search/copy/reexecution and focus | Implemented and exercised on M2 |
| AI attachment | Async/private guards implemented; real end-to-end attachment still pending |
| Persistence | No schema or stored-state change |
| Native core and Rust IPC | Existing typed bounded actions reused; no Rust source change |
| Pi/MCP | No new command, schema or terminal text exposure |
| Capture/privacy | Foreground composition implemented; private window/pane refused |
| Accessibility | Known roles/labels, status/error announcements and actual search/editor focus checked |
| Linux/Windows | Not executed for this UI slice |
| Default rollout | Deferred until full functional parity |
| Performance measurements | Not required; 60 FPS is a later optimization |

## Verification provenance

All project execution and edits: M2, isolated worktree
/Users/andres.rojo/Workspaces/terax-worktrees/native-block-ui,
branch feat/native-terminal-block-ui, clean starting commit 7acdbc7.
The baseline passed eleven repository gates before this slice. The protected Mac was not edited or used for project execution. Two modified plans were found in the separate M2 main checkout and left untouched and outside this commit. Local Sendery commits only; no Actions, push, PR, merge or benchmark.

Pinned prebuilt libghostty-vt 0.2.2, Ghostty
a887df42c56f6de86c0fe6da9c4eeca37931e083.
Archive SHA-256:
fd8ca44691ced7b1fa368666fb5546ba8bf4318b717b356ea0a36a2aada49fe0.
No source/Zig fallback was used.

Observed red before fixes: missing controller/adapter/watermark contracts, native blocks rejected by router, delayed click overtaking a newer press, hidden same-sequence projection, missing foreground composition, CSS-hidden promotion and lost ancestor clipping. Actual UI showed Find returning input to CodeMirror and Escape leaving AXWindow focused; both were corrected through lifecycle receipts and verified again. No assertion, configuration or skip was weakened. Independent final source review closed its findings and reported no further blocking finding.

Focused models, capture tests and types passed. An intermediate full frontend run passed 2496 tests with one existing skip before the final capture regressions. Final floor results are recorded below after execution.

## Real M2 acceptance

The actual sandbox and authenticated bridge reported the expected repository, branch and base commit. Temporary owned blocks tabs A/B used distinct native engines:

- Identical drafts stayed independent across tab switches; each command ran exactly once, and empty Enter did not repeat it.
- A real foreground read program accepted NATIVE_REPLY through native input and returned focus to an empty CodeMirror prompt.
- Scoped Find for ana showed 1/4, repeated Find focused the same input, Next showed 2/4, and Escape restored CodeMirror.
- Menu Copy output and keyboard block selection/copy pasted the exact known Unicode body into the owned editor. The body retained its combining mark even though rendering it remains incomplete.
- UI Run again produced the second and only second fixture acknowledgement.
- Returning to a hidden blocks tab restored its controls without new PTY output.
- Existing ordinary native split panes executed separate cwd acknowledgements after the first click in each pane.
- Private terminal window and pane captures were both refused without state mutation.
- Temporary fixture tabs were closed and the prior ordinary split tab restored before intentionally stopping the owned dev process tree.

Blocks splitting is disabled by the existing product baseline and was preserved. An attempted split stopped before writing pane fixtures; split acceptance used the supported ordinary native tab. An immediate missing right-pane file was a pending acknowledgement; polling the already-sent command proved it without resending.

Inspected artifacts under the ignored worktree visual-QA directory:

- 20261115T102723.400Z-block-overlay-menu-real-CrHAgO/screenshot.png
- 20261115T103442.959Z-block-overlay-search-four-bf6kad/screenshot.png
- 20261115T104449.894Z-block-overlay-copied-output-z9ktdp/screenshot.png
- 20261115T104721.804Z-block-overlay-native-draft-b-preserved-Jisi5W/screenshot.png
- 20261115T110105.980Z-block-overlay-normal-split-regression-ugfYBH/screenshot.png

The optional preexisting Google SDK shell-init read-denial lines are unrelated to the terminal implementation. Automation now resolves known controls against current authenticated AX window bounds rather than reusing screenshot coordinates.

## Final repository gates

All eleven final block-overlay-final commands passed after the intentional dev shutdown.
Frontend: 2500 passed plus one existing skip. Pi: 101 passed. Node: 43 passed.
Plain Rust: 602 unit plus 58 integration passed, one existing ignored.
Native Rust: 741 unit plus 58 integration passed, two existing ignored.
Strict clippy passed both configurations.
Lint comparison by path/category/message/severity: 119 warnings and two infos,
versus the baseline 120 warnings and two infos. Zero additions; one obsolete
NativeTerminalPane suppression warning removed. No rule suppression added.
Exact commands, all passed:
```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
pnpm --dir packages/pi-terax test
node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs
cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked
.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --all-targets --locked --features ghostty-engine -- -D warnings
.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --target-dir /Users/andres.rojo/Workspaces/terax-ai/src-tauri/target --locked --features ghostty-engine
git diff --check
```

The build includes the Pi package build. No global CARGO_TARGET_DIR is set for Node policy tests. Native checks share the explicit target only sequentially while dev is stopped. Full lint diagnostics are compared against the baseline, including warnings that do not fail the command.

## Remaining functional replacement

Full submitted-command association is not finished: shell metadata can truncate command text, and Bash needs an authoritative full-command path. Wrapped command headers need native prompt/command anchors; narrow captures exposed overlap. The renderer still uses the first codepoint rather than the complete grapheme, so composed and ZWJ glyph parity remains pending. Full TUI/mouse/readline, settings, notifications/clipboard protocols, AI consumers, agents/tasks/restore, graphics/HiDPI and platform acceptance still require functional verification before default rollout.

This UI integration is a validated milestone. The user's full terminal replacement objective remains active. No FPS gate or laboratory work is required.

Primary clipboard documentation: [WebKit Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/) and [WebKit issue 222262](https://bugs.webkit.org/show_bug.cgi?id=222262).
