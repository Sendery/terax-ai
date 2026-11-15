# Terminal replacement: parity and completion evidence

The active objective ends when a usable Terax version has the new terminal
and preserves or improves the current project's capabilities. A working lab,
compiled core, passing fixtures or faster benchmark is not that version.
The phase 0 through 5 handoff remains in scope, including its rollout and soak.

## Current user priority

The [2026-11-14 priority update](2026-11-14-terminal-migration-priority.md)
supersedes the earlier mandatory 60 FPS exit gate. FPS is an optimization
objective, not a blocker to functional migration. Stop further laboratory
experiments and prioritize ordinary tabs/panes and all existing consumers.
Keep negative measurements as evidence; do not call them passing or parity.

## Baseline and evidence rules

This source audit uses the normal terminal at `0c573d8` on the M2 feature
branch. The original checkout's `e485e59` commit is an ancestor; the M2 source
contains its functionality plus subsequent fixes. This audit does not copy or
reset the original working tree. The normal xterm frontend remains unchanged
from `ad27cf6`; the experimental engine remains feature gated. The 2026-11-15 ordinary-pane integration is an explicit sandbox opt-in, with evidence and gaps recorded below.

Status below describes implementation evidence, not delivered parity. Every
row remains open until its observable result is exercised through ordinary
new-engine terminal panes and applicable app consumers. Unit tests establish
an invariant only within their tested scope. Native M2 tests do not establish
Windows/Linux runtime behavior, and headless WASM tests do not establish
Worker or WKWebView performance. Do not silently remove a setting or feature
to close a row; an alternative must deliver the same or better user behavior.

## Input, grid and terminal interaction

| ID | Existing capability and primary source | Current new-engine evidence/gap | Observable completion evidence |
|---|---|---|---|
| T01 | Ordinary tabs and split panes: `TerminalStack.tsx`, `PaneTreeView.tsx`, `TerminalPane.tsx`, `useTerminalSession.ts` | `EngineSession` is an isolated lab session; normal panes still use `openPty` and the xterm registry. A shared lifecycle controller and explicit Ghostty transport adapter now cover opening, ordered input, awaited resize and retirement; the full normal-pane surface is not connected yet. | Open, split, focus, close and reopen ordinary new-engine panes; retain pane/PTY identity and all app controls without xterm owning the active terminal. |
| T02 | Negotiated keys and Shift+Enter: `keyboardProtocol.ts`, `keymap.ts`, `rendererPool.ts` | `gl/keyInput.ts` explicitly implements only Phase 1 keys; Shift does not change Enter, and Kitty/application-cursor/modifyOtherKeys encoding is not wired through Rust. | Claude Code, Pi and Codex accept text, navigation, shortcuts and multiline Shift+Enter under their negotiated modes. A protocol must not be advertised without correct encoding. |
| T03 | IME/dead keys: `compositionCommit.ts` and its regression tests; renderer textarea hooks | The lab has textarea composition handling, not the complete existing commit-filter integration. | Spanish dead-key accents and CJK composition commit once, preserve cursor placement, and never send the candidate-confirming Enter as a command. |
| T04 | Paste and clipboard: `terminalClipboard.ts`, xterm `paste`, `TerminalContextMenu.tsx` | Lab `encodePaste` only normalizes newlines; it does not consult bracketed-paste mode or route all OS clipboard actions. | Multiline paste reaches shells/TUIs safely, with bracketed paste only when negotiated; native Linux clipboard fallback and macOS/Windows actions continue to work. |
| T05 | Mouse input, selection and right-click policy: xterm modes, `pointer.ts`, `TerminalPane.tsx` | The new input binding focuses on pointer-down and scrolls by wheel; there is no Rust selection or negotiated mouse reporting surface. | Drag, word/line selection, copy, existing-selection right-click, context menu and mouse-enabled TUIs work per pane with correct coordinates/modifiers. |
| T06 | Focus reporting and input ownership: xterm, block shell input, terminal keymap | New focus handlers change renderer focus only; no terminal focus encoder is called. | Programs requesting focus reports receive them; app shortcuts, readline navigation, editor focus and TUI keys retain their established ownership. |
| T07 | Unicode text and cell width: xterm's live grid and buffer consumers | V1 intentionally transmits only the first codepoint of a grapheme; `snapshot.rs`, `frame.rs` and `glyphAtlas.ts` confirm this. The existing wide/combining golden checks that reduced V1 behavior, not full combining-text parity. | Combining accents, CJK wide cells and multi-codepoint emoji render and copy correctly, including width, wrapping, resize/reflow and search. Update the shared format and both codecs together when required. |
| T08 | Resize, scrollback and viewport: FitAddon, `terminalScrollback`, `useTerminalSession.ts` | Kernel/core resize and native scroll exist; the lab checks a 10000-row history. The core budget is bytes, while the current preference describes rows. | Resize/reflow preserves text and cursor; wheel/page/history navigation and configured retention have an explicit equivalent meaning with bounded memory. |
| T09 | Fonts, live themes, zoom, spacing, cursor and image-background contrast: `termOptions`, `apply*` in `rendererPool.ts` | Lab colors/font/metrics have partial coverage. Normal preference wiring and equivalent minimum-contrast behavior are unverified. | Change each existing terminal setting live across multiple new-engine panes; verify colors, cursor focus/blink, dimensions, theme switching and background readability. |
| T10 | WebGL preference, fallback, context recovery and manual redraw: `rendererPool.ts`, `atlasRepaint.ts`, `terminal.redraw` | The new renderer requires WebGL2 and handles context restoration, but has no demonstrated equivalent for disabling/unavailable WebGL. | Terminals remain usable with the supported GPU preference/fallback and after context loss/display wake; redraw restores every visible pane without atlas corruption. |
| T11 | URL/OSC 8 and file links: `terminalLinks.ts`, `fileLinks.ts`, renderer link providers | Bounded immutable metadata for actually drawn frames now supports native URL/OSC 8/file links. M2 proves plain/OSC 8/wrapped URL opening, quoted files with line/column, new/reused editor focus, selection/menu preservation and first inactive-pane click after divider movement. See the native-links report. Other-platform runtime and hover/capture-overlay proof remain open. | Modified-click opens a permitted URL or the correct local file/line, respects cwd/home/workspace and restores focus; invalid or forbidden targets remain rejected. |
| T12 | File drops: `useTerminalFileDrop.ts`, `quoteShellPath.ts` | The drop path calls xterm `pasteIntoLeaf`. | Dropping files on a new-engine split targets that split, preserves quoted paths with spaces/shell characters, paste semantics and physical/logical coordinate handling. |

## Shell, application and agent integration

| ID | Existing capability and primary source | Current new-engine evidence/gap | Observable completion evidence |
|---|---|---|---|
| A01 | Local cwd and readiness: OSC 7/133 handlers, shell init scripts, `markSessionReady` | A bounded actor-side observer and correlated OSC 133 markers now publish versioned CWD/readiness/running state. M2 ordinary zsh splits preserve independent Unicode/space CWD across focus/tab changes and ignore forged unsigned D/A plus OSC 7. Actual zsh/bash script bytes and native ordering are tested. Fish/PowerShell/WSL runtime and complete consumer scenarios remain open. | `cd` updates the correct pane and downstream cwd consumers; command output cannot spoof local cwd; readiness follows the shell rather than a guessed delay. |
| A02 | Blocks mode: `blockController.ts`, `BlockDecorations`, `BlockOverlay`, `ShellInput` | Opt-in native core tracks authenticated C/D boundaries with bounded native references, output reads, status/duration and EOF. Native draft/input ownership, repeated-prompt revisions and bounded frame-specific projection are implemented. Default false; ordinary blocks panes and their UI/actions remain legacy. Full commands, cell damage and shared overlay/actions still need integration. See the native-block-core report. | Prompt/running/alternate-screen transitions, command text, exit status/duration, navigation, output selection, rerun, block search and input drafts work through stable Rust row anchors. |
| A03 | Header search: `SearchInline.tsx`, App's SearchAddon maps | The minimal shared search contract and native actor now drive the normal header. M2 proves incremental/full retained history, both directions, active/all highlights, clear, compact focus, split/reflow and original shell identity; Unicode, retained exit and stale-response invariants have native/client tests. See the 2026-11-15 native-search report. Other-platform runtime acceptance remains open. | Incremental search, next/previous, highlights, clearing and focus restoration work across live/history text and survive pane changes and reflow. |
| A04 | Selection actions: `TerminalContextMenu.tsx`, selection popup, notes/Mermaid/TTS actions | Text selection APIs still read xterm; engine selection is missing. | Copy, Ask Terax, Add to Note, Open Mermaid and Read Aloud receive the same captured selection and never switch to a different pane or post-click selection. |
| A05 | OSC 52 clipboard writes: `osc-handlers.ts` and tests | No clipboard callback/event bridge is installed on the engine path. | Preserve clipboard-only targets, bounded valid UTF-8 decoding, ignored queries/unsupported selections and nonblocking writes; do not add clipboard-read exposure. |
| A06 | Hidden panes, busy agents and renderer reassignment: `poolPolicy.ts`, `DormantRing`, `useTerminalSession.ts` | Rust owns a persistent grid in the lab, but normal tab visibility/retention and full-frame rebuild are not integrated. | Hide/show and switch crowded split tabs without losing output, selection/scroll state or a running TUI; hidden rendering does not accumulate unbounded work. |
| A07 | Agent activity/attention/exit events: `pty/agent_detect.rs`, `AgentNotificationsBridge.tsx` | Native detection still sees raw bytes, but `leafIdForPty` resolves the old frontend session registry. | Real Claude/Pi/Codex sessions in two splits report activity, attention and completion once in the correct pane, also while hidden. |
| A08 | Agent session capture/restore: `useAgentSessionCapture.ts`, `useAgentSessionRestore.ts`, `restore.test.ts` | Restore calls old `whenSessionReady`/`submitToLeaf`; private exclusion and saved pane/session identity need new-engine integration. | Restart with multiple agent splits and resume the right conversations/cwd once, after shell readiness; private sessions remain excluded. |
| A09 | Scheduled handoff: `tasks/lib/handoff.ts`, `App.tsx` task adapters | Readiness, Shift+Enter and before/after buffer comparison use old session helpers. | Deliver a multiline task once to the selected agent; verify a real turn starts, and never report success with a missing/unchanged unavailable buffer. |
| A10 | AI live terminal context and managed agents: `useAiLiveBridge.ts`, terminal tools | `getBuffer` reads xterm or a serialized fallback; a bounded native `gterm_read_text` surface now exists with history, Unicode and error validation. The app bridge now awaits native-compatible reads and rechecks tab/leaf/handle/privacy before redaction. AI tools, managed agents and task buffer comparisons await results; missing text cannot confirm a submitted turn. Actual native ordinary-pane integration remains pending. | Supply normalized bounded active/history text, correct leaf/cwd and managed-agent input; preserve redaction and private-terminal exclusion. |
| A11 | Pi/MCP control, discovery and privacy: `pi.rs`, `shell_init.rs`, command registry/snapshot tests | Launcher/discovery infrastructure is shared, but integration with normal new-engine panes is not verified. | Pi launched inside a new-engine terminal discovers/control the app; command allowlists, token/framing limits, private snapshots and capture restrictions remain intact. |
| A12 | Shell/workspace/platform environment: `pty/shell_init.rs`, WSL and Unix/Windows launcher tests | `session::spawn` is reused, which is partial implementation evidence. | Native macOS/Linux/Windows shells and WSL where supported get the right cwd, environment, workspace, discovery and lifecycle. Preserve independent per-pane state. |
| A13 | Process/failure lifecycle: `pty/session.rs`, `EngineThread`, `bench::run` | A separate native core registry now retains the grid after healthy process completion, with an independent post-exit failure signal and presentation resize. Real-PTY tests cover retained text, replies/final-frame ordering, post-exit faults and explicit retirement. Normal-pane integration and platform exercise remain pending. The audit reproduced exit 0 after a rejected final frame, for a real PTY and benchmark. The accompanying fix makes engine failure sticky, propagates -2 once, rejects unusable opens/input and schedules normal teardown off the engine thread after notifying failure. An unconfirmed Windows reader drain is rejected, not treated as solved ConPTY behavior; native Windows cleanup remains unproven. Release still uses `panic=abort`, so dev unwind tests do not prove release panic isolation. | Final healthy output precedes exit; channel loss, panic or engine death visibly invalidate the session, cannot pass a benchmark, and close owned resources without duplicate exit or blocking callbacks. |
| A14 | Remaining app flows: editor, files, notes, AI composer, task/agent notifications, layout and capture | They remain existing DOM/app modules, but their terminal adapters must be migrated rather than removed. | Exercise these flows with new-engine panes active, including narrow layouts, focus, keyboard operation and private content. A terminal replacement cannot disable another product surface. |

## Performance, delivery and requested improvements

| ID | Requirement | Evidence required before completion |
|---|---|---|
| D01 | Phase 0: prebuilt core, reproducible builds and licenses | Native no-source-fallback tests through the wrapper, correct archive/ABI/notices, clean checkout evidence and supported target validation. M2 provisional success is not canonical publication or Windows acceptance. Never execute Actions for this task or build on the protected original Mac. |
| D02 | Informational performance target: 60 fps in twelve repainted panes | The accepted Channel result remains **no**, roughly 35 to 53 minimum pane updates/s. The existing registered evidence remains archived with native/runner provenance and teardown results. Further measurements are deferred unless requested or needed to diagnose a concrete functional regression. The user made 60 FPS optional; these results no longer block functional migration. |
| D03 | Recorded diagnostics and deferred optimization | The credit experiment is measured and closed in `143c139`: valid confirmation remains below 60 FPS. Window-frame optimization is deferred by the user priority update. Do not substitute diagnostics for functional delivery. |
| D04 | Requested new capabilities | Preserve the earlier plan's Kitty keyboard/graphics, grapheme clustering/mode 2027, OSC notifications 9/99 and progress 9;4 with tests and real app exercise, without FPS regression. Ligatures retain the plan's conditional feasibility decision; they are not an existing loaded addon in this baseline. |
| D05 | Dev default, release and cleanup | After normal-pane parity, switch dev first and validate real workloads with more than ten split tabs and many agent panes for days. Release/default switch and removal of xterm, rendererPool, DormantRing and da_filter follow the phase gates and branch review. Do not remove the old implementation before its replacement covers consumers. |

## Completion audit

Before marking the objective achieved, inspect a real runnable version from
its recorded source and verify every row above with the new engine active in
normal terminal panes. Include native behavior, actual pixels and interactions,
privacy/error cases, target-platform evidence and the applicable real-workload
soak. Performance measurements are informational and deferred by user priority. Record the test/artifact for each row,
its scope and any deliberate equivalent improvement. An unverified row stays
open. No row is closed merely because xterm still provides it in another mode.

Current conclusion: build/lab infrastructure has progressed, but normal-pane
integration and capability parity are incomplete. The user priority update makes the former Phase 1 performance gate
non-blocking. Functional parity remains the delivery requirement.

## Current failure-path correction evidence

The normal-pane rows above remain open. This correction closes a specific
false-success bug in the experimental engine, not the full parity objective.
On M2, `a_rejected_final_frame_is_not_a_successful_benchmark` and
`a_rejected_final_frame_invalidates_even_a_zero_exit_shell` were observed
failing against the starting production code at `0c573d8`: both returned 0
after initial send success and final send rejection. They now reject success.
The healthy real-PTY device-query/final-frame/exit-code-3 regression still passes.

Additional checks cover failure before a pipeline subscribes or receives
another PTY byte, a Rust engine panic, callback reentry/exception, a frontend
failure before its open id, blocked deferred credits and the conservative
reader-drain decision. The existing closed-channel parsing assertion remains
1500 bytes; its join now additionally reports failure. Reader/core completion
is joined in the owned M2 PTY tests. Windows behavior has only policy coverage
here, not native ConPTY proof. Current release `panic=abort` also remains a
separate rollout concern; dev unwind tests do not establish release isolation.

The source started clean and all baseline gates passed. Final M2 checks passed:

- `pnpm lint`, `pnpm check-types`, `pnpm test` (2303 passed, one existing skip), `pnpm build`.
- `pnpm --dir packages/pi-terax test` (101 passed).
- `node --test scripts/*.node-test.mjs scripts/libghostty/*.node-test.mjs` (42 passed).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings` and `cargo test --manifest-path src-tauri/Cargo.toml --locked` (588 unit and 58 integration, one ignored).
- `.terax/pi-development/m2/with-ghostty cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked --features ghostty-engine -- -D warnings` and `.terax/pi-development/m2/with-ghostty cargo test --manifest-path src-tauri/Cargo.toml --locked --features ghostty-engine` (629 unit and 58 integration, two ignored).
- `git diff --check`; raw xterm pipeline compared byte-for-byte to the starting source and left unchanged.

An initial clippy complexity diagnostic was fixed with a callback type alias,
without suppressions or configuration changes; the complete floor was rerun.
Independent Astra review required notification before teardown scheduling and
explicit rejection of an unconfirmed drain. Those corrections were applied.
No new graphical/60-fps, Windows runtime, release-panic or soak acceptance is
inferred from these checks. No Actions or protected-host native build ran.


## Ordinary-pane integration update (2026-11-15)

See [the integration report](2026-11-15-terminal-normal-pane-integration.md).
T01 now has actual normal-window startup, split, mouse focus, tab hide/show and
surviving-pane close evidence on M2, using native gterm sessions and the real
shell PIDs. A fixed renderer hot reload conserves the logical process and
recovers its displayed content. T02 through T06 and A04/A06/A07/A09/A10/A13 now
have ordinary-pane adapters and native state/selection/input foundations;
their full product scenarios remain unverified. No capability row is closed by
this update. Inactive native-pane capture rejects clearly until offscreen
capture is implemented. Shell CWD/readiness, blocks, search and links remain
priority gaps. No further lab or FPS measurement was run.


## Native shell integration update (2026-11-15)

[Native shell integration report](2026-11-15-terminal-native-shell-integration.md)
records the next vertical slice after ordinary-pane startup. A01 now has actual
normal M2 zsh CWD/focus/tab-return and forged-output rejection evidence, plus
real zsh/bash script and ordered native state tests. Native opening is not shell
readiness; generation/exit/failure regressions reject stale ready signals. A08
and A09 still require complete agent restore/task scenarios, and A01 remains
open for other supported shells/platforms. Search, links and blocks are next.


## Native links update (2026-11-15)

See [the native-links report](2026-11-15-terminal-native-links.md). T11 now has ordinary M2 interaction evidence and bounded native/client regressions. It remains open for platform and hover/capture proof: the app rasterizer currently paints native canvas crops after DOM overlays. The full migration and default rollout remain incomplete. No new performance lab was run.


## Native block-core update (2026-11-15)

See [the native-block-core report](2026-11-15-terminal-native-block-core.md).
The actor and real macOS zsh/PTY path now have bounded tracked-block evidence;
A02 remains open until native UI, drafts, actions, command completeness and
damage/projection behavior are integrated and exercised. All complete gates
passed on M2. This backend change does not establish other-platform runtime
acceptance, native blocks UI parity or default rollout.
