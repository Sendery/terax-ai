# Native terminal completion implementation

This is the single implementation pass from qa code 8634b18 and frozen
checkpoint 8097cc172879477dda6fa18837cd68e319e91712. It is source delivery for
the subsequent general sweep, not functional acceptance or default rollout.
All work ran in the isolated M2 completion worktree, with the existing Sendery
identity. The running sandbox, other worktrees and the protected original Mac
project were preserved.

## Added in this pass

Native mouse input now uses the pinned Ghostty mouse encoder on the same
ordered input queue as keys, paste and focus. Tracking and encoding come from
the terminal at execution time, covering X10, normal, button/any motion, UTF8,
SGR, urxvt and SGR pixels. DOM geometry is physical terminal-relative pixels.
Primary/middle/secondary and side buttons, vertical/horizontal wheel and
releases are connected. Vertical wheel in an alternate screen without mouse
tracking sends one negotiated Up/Down key, preserving the legacy TUI fallback.
Shift retains local selection; modified link activation
and the macOS control-click menu remain available. Motion has one pending
latest event and one in-flight request. Wheel repeats are bounded and encoded
in one request per axis. Selection drag autoscroll uses one timer only while
dragging outside the pane. Hiding a pane clears input focus and active gestures.
A short Alt-click at the bottom of the viewport moves the cursor via the live
native encoder, with primary horizontal and alternate wrapped-row navigation.
Native cursor/grid/viewport checks and frontend owner/focus/gesture guards
discard stale targets while allowing the selection's own redraw.

Normal readline navigation/deletion uses the existing product keymap, while
negotiated Kitty/modifyOtherKeys and alternate-screen programs retain native
encoding. Non-macOS Ctrl+Insert and Shift+Insert use the existing clipboard\nchannel, matching the legacy copy/paste shortcuts. Healthy exited panes keep focus, selection, copy and history
navigation while declining new writes, mouse reports and focus reports.

OSC9 text and OSC99 title/body, id-separated multipart and base64 text now use
terax:agent-signal, the existing notification preference, deduplication, bell
history and OS notification channel. These explicit notifications do not
invent an agent session or claim a turn ended. Pending notifications are
bounded to eight, text to 160 Unicode characters per title/body, encoded
payloads to 4096 bytes. Query, icon, buttons and application report callbacks
are not advertised or executed. Close cancels an unfinished assembly; it does
not claim to retract an already delivered OS notification. Terminal control
strings cannot smuggle nested notifications. Private sources are excluded
before routing and rechecked after async badge preparation.

OSC9;4 progress follows the same event channel and a bounded ephemeral
PTY-owned pane store. It shows determinate, indeterminate, error and paused
progress without changing agent working/waiting state. Equal progress is
coalesced, command end/PTY EOF clears it, and a retired owner cannot clear a
replacement owner's progress. Progress is not persisted or exposed by a new
Pi/MCP command.

Kitty Unicode placeholders now resolve image/placement ids from original
foreground/underline style colors and row/column/high-byte diacritics.
Adjacent omitted diacritics inherit only compatible values. Dirty native rows
update bounded per-viewport runs, so text erasure/reflow/history changes alter
placement geometry rather than leaving fixed-position images. Virtual
prototype placements use aspect-preserving fit and each visible row is cropped
from the source. Placeholder text is suppressed in the glyph layer.
Both GPU and Canvas2D render fractional source slices, including one source
pixel spread over several terminal rows. Existing direct-image subformat 1 is
unchanged; subformat 2 adds finite f32 geometry for virtual fragments. Full
frames still reconstruct images after hiding, capture or presentation recovery.

The diacritic data comes from the exact pinned Ghostty source
src/terminal/kitty/graphics_unicode.zig, under the existing bundled Ghostty MIT
notice. No core source, C ABI, header, safe/sys wrapper, archive or pins changed.

## Current source inventory

Historical parity tables describe earlier checkpoints. This table records
current implementation; every row still needs applicable real-app acceptance.

| Capability | Current source implementation | Sweep focus |
| --- | --- | --- |
| Tabs, splits, hidden/busy, lifecycle and retained exit | Already present: NativeLeafSession, EngineSession, shared registry and actor ownership | Floods, hidden TUIs, split close, failure, respawn and retained output |
| Keyboard, Kitty, Shift+Enter, IME/dead keys | Already native encoder/composition policy; readline added here | Claude, Pi, Codex; CJK and Spanish accents; press/repeat/release |
| Mouse, focus, selection, menu | Native selection existed; negotiated reporting, autoscroll, hidden focus and exited input fixed here | Mouse TUIs, Shift override, links, right-click, off-pane drags, mixed DPI |
| Paste and clipboard | Already present: negotiated paste, OS fallbacks, OSC52 mailbox and owner checks | Multiline input, private manual input, stale reads, target OS clipboard |
| History, reflow, settings | Already present: exact rows, applied receipts, Cmd+K host clear, font/theme/zoom/spacing/cursor/contrast | Every preference live/hidden/respawn, shrink with selection/search/blocks |
| GPU/software/redraw | Already present: shared surface, bounded Canvas2D and renderer migration | Software pixels, context loss, display wake, redraw and process identity |
| Search, URLs/OSC8/files, drops | Already present: drawn-frame anchors, editor routing, physical file drops | Wrapped/Unicode paths, scope changes, split targets and stale replies |
| CWD/readiness/environment | Already present: authenticated OSC7/133 and shared spawn | zsh/bash/fish/PowerShell/WSL on applicable platforms |
| Blocks, drafts, actions, headers | Already present: shared overlays and per-owner native blocks | Empty/long/multiline commands, output overwrite, drafts, search/rerun and exits |
| Selection actions, notes, Mermaid, TTS, AI | Already present: shared handles and frozen menu selection | Correct pane/captured selection, privacy changes, UI focus |
| AI context/tools and managed agents | Already present: awaited bounded facade reads and owner/privacy validation | Native active/history context, stale owner, managed submissions and redaction |
| Agent activity and notifications | Existing PTY detection/registry reused; explicit OSC9/99 and progress added | Real split agents, hidden notifications, dedupe, private/closed owner |
| Restore and scheduled handoff | Already present: owner-bound readiness/submission and text-confirmation logic | Restore once, multiline task once, unavailable/unchanged text never success |
| Active/inactive capture | Already present: frozen frame and foreground projection | Images, blocks, software, private and cancellation with unchanged focus/PIDs |
| Pi/control/discovery/privacy | Existing shared spawn/discovery and semantic facade reused; no endpoints added | Pi started inside native panes, snapshots, refusals and capture scopes |
| Graphemes and Kitty graphics | Full clusters/mode2027/direct images already present; virtual placeholders added here | Complex clusters, resize/search/copy, direct/virtual images and reconstruction |

Bash authoritative full-command capture remains unavailable as in the legacy
baseline. The existing compatibility evidence is retained; no history/timing/
Readline heuristic is substituted. Blocks keep their existing single-leaf
restriction. The current legacy setup does not enable a ligature addon or
screenReaderMode setting, so neither is silently removed by this pass.

## Conditional ligature decision

Do not enable cross-cell ligatures in this candidate. The atlas stores one
native cell/grapheme at a time and shares it across arbitrary style, cursor,
selection and pane boundaries. Browser shaping of a string spanning cells
would require a new run model with exact cell-to-cluster ownership and
invalidation. It cannot be introduced by turning on a font CSS flag without
changing text coverage and selection/cursor behavior. Complete graphemes and
their within-cluster shaping remain enabled. Cross-cell ligatures stay the
original conditional enhancement, pending an independently justified bounded
run design, rather than a missing legacy capability or a new performance lab.

## Rollout and external requirements

Keep xterm fallback, feature gating, explicit VITE_TERAX_TERMINAL_ENGINE=ghostty
and the sandbox identity. No default switch, removal, release or publication.
The verified native-core-v1 archive remains
c390cf1908007dc0ab9f1c6914384532c8482cbd6fbe5aea2752e610425e09ae.
Consumers stay prebuilt-only with no Zig fallback.

M2 source tests do not establish Intel/Linux/Windows/ConPTY runtime, physical
mixed-DPI behavior, runtime on macOS 11, matching native-core-v1 target archives,
canonical publication, release panic isolation or the real-workload soak.
The app minimum and archive minimum must be reconciled before a native default
on each supported target. The unchanged production fallback remains necessary.
60 FPS is optional and no further performance laboratory was run.

The next step is root's single general sweep: full repository gates, one
matching sandbox build, then ordinary pane interactions and privacy/failure/
capture scenarios. Concrete failures then return to atomic worktrees.

## Lightweight checks before handoff

Passed on this worktree with the verified existing native archive:

- pnpm check-types and focused Biome lint/format for changed TypeScript.
- 51 tests in eight focused files: nativeKeyboard, nativeInputBinding,
  graphicsCodec, graphicsRenderer, canvasGraphics, terminalProgress,
  routePrivacy and route. The graphics codec consumes a fixture emitted by the
  actual Rust snapshot, including fractional one-pixel virtual rows.
- Cargo lib tests with ghostty-engine: input 13, graphics 11, snapshot grapheme
  tests 2, terminal_signals 3 and agent_detect 32. These filters ran as their
  implementations stabilized; unrelated baseline suites were not repeated.
- Strict Cargo Clippy for lib with ghostty-engine and git diff --check.

All Cargo consumers used the explicit shared target directory
/Users/andres.rojo/Workspaces/terax-ai/src-tauri/target through the worktree's
verified prebuilt helper. No app build, producer rebuild, UI run, performance
measurement or general suite was performed in this pass.
