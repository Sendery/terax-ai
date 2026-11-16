# Native terminal acceptance status

The active goal is a usable Terax with the new terminal and the same or better
existing capabilities. It is not complete. This checkpoint audits local qa
5cbd0e61991c4af0ada8cdedd6dea02d935d9fa0 and the actual packaged source
2d869a350465443b4bb860f5d3a9ee098dc2ddff. It changes documentation only.

The [parity inventory](2026-11-14-terminal-parity.md) supplies requirement IDs.
Its old missing-code descriptions are chronological. The
[current implementation inventory](2026-11-15-terminal-complete-implementation.md)
and [general validation](2026-11-16-terminal-general-validation.md) establish
later implementation and scoped runtime evidence. An accepted case below does
not close its whole category or prove another platform. No new missing adapter
is inferred solely from an unrun acceptance case.

## Current cases and next work

The order continues the functional sweep. Retain earlier accepted cases rather
than repeating them without a relevant change or unresolved concern.

| Order and requirements | Accepted cases and implementation evidence on M2 | Next cases still open |
| --- | --- | --- |
| 1. History and preferences, T08/T09 | Physical Cmd+K preserves the PTY; font size and letter spacing update visible and hidden panes. The ordinary live-trim case below preserves the clipped selection and invalidates the old search result. | Blocks trim and unavailable anchors/output; cursor blink/focus, font family/weight, zoom, theme and image-background contrast. No all-settings acceptance follows from the two geometry controls. |
| 2. Keyboard, composition and paste, T02/T03/T04 | Real peer proves Kitty press/repeat/release, Shift+Enter and focus reports. Real Pi preserves a multiline draft through hide/continue. OSC52 system-clipboard cases are accepted separately. | Dead-key accents and CJK commit once without submitting candidate Enter; actual multiline paste with/without negotiated brackets; real Claude/Codex navigation, multiline and redraw. |
| 3. Pointer, links and file drops, T05/T11/T12 | SGR cell/pixel reports, alternate-screen wheel and short Alt-click are accepted. Earlier native-link cases cover plain/OSC8/wrapped URLs and quoted file line/column routing. | Actual OS file drop to both splits with Unicode/space/metacharacter paths; word/line/rectangle selection, off-pane autoscroll and selection-preserving right-click; remaining hover-overlay and physical DPI cases. |
| 4. Selection, AI and app consumers, A04/A10/A14 | Native popup Add to Note is accepted after the semantic-revision correction. Async context/selection and owner/privacy adapters are implemented. | Mermaid, TTS, Ask Terax and block attachment with the captured selection; bounded active/history AI context and managed-agent input; privacy/owner changes during pending work. |
| 5. Blocks, A02 | Independent drafts, foreground input, scoped Find/next/Escape, Unicode output copy, rerun and controls after reveal were exercised in the block-overlay slice. The general sweep verifies complete multiline copy and once-only rerun. | Commands longer than 256 characters, wrapped header geometry, empty/overwritten output and eviction of tracked anchors. Blocks splitting remains disabled as in baseline. |
| 6. Agents, restore and handoff, A07/A08/A09 | Owner-bound capture, readiness/submission and task-delivery logic have directed source tests. Real Pi hide/continue is accepted. | Real split activity/attention/exit; correct conversation/CWD restoration once after readiness; multiline scheduled delivery once, with unavailable/unchanged buffers never reported as success. Pi draft persistence does not establish these cases. |
| 7. Lifecycle and busy hidden panes, T01/A06/A13 | Ordinary startup/split/focus/surviving-pane close, hide/reveal and renderer replacement have real evidence. Native tests cover final output and sticky failures. | Known finite output while another pane remains usable, hidden output conservation, healthy exited output with copy/search/history, and failure that visibly invalidates the correct owner. No throughput experiment is needed. |
| 8. Renderer recovery, T10 | GPU to Canvas2D to GPU preserves image pixels and original PTYs. | Actual context loss/display wake and manual redraw across several panes. Preference switching alone does not prove those recovery triggers. |
| 9. Unicode and inline graphics, T07/D04 | Mode 2027 clusters, direct PNG/RGB/RGBA/z layers, and virtual one-pixel placeholders spanning rows have real pixel evidence, including GPU/software. | Reflow/search/copy for complex text, cropped edges and image scroll/history interactions. These paths have implementation/native tests; remaining pixels are not absent code. |
| 10. Capture and privacy, A11/A14 | Active/inactive ordinary captures preserve focus and PTYs. Private active/hidden surfaces refuse scoped/window captures; an explicit inactive public pane remains capturable. GraphX capture is accepted separately. | Inactive blocks/images/graphemes and software capture together; retired owner and mid-capture privacy changes; unchanged viewport and focus. |
| 11. Explicit notifications and progress, A07/D04 | Pane-owned progress 42 appears and clears; hidden multipart OSC 99 reaches the bell without inventing an agent session. | OS banner title/body, OSC9, error/paused/indeterminate progress and private/stale-owner behavior. A bell row displaying the body does not prove the banner title. |
| 12. Shells and supported targets, A01/A12/D01/D05 | Ordinary zsh CWD/readiness, pane isolation and spoof rejection are accepted. Real zsh/bash integration and verified arm64 prebuilt consumers have scoped evidence. | Fish/PowerShell/WSL and supported target environments; matching extended-core target artifacts, runtime failure behavior and rollout gates below. M2 tests do not stand in for those systems. |

See the [block-overlay evidence](2026-11-15-terminal-native-block-overlay.md),
[grapheme evidence](2026-11-15-terminal-native-graphemes.md),
[image evidence](2026-11-15-terminal-native-images.md),
[link evidence](2026-11-15-terminal-native-links.md) and
[clipboard evidence](2026-11-15-terminal-native-clipboard.md).
Source boundaries for the still-open consumer scenarios are documented in
[agent restoration](2026-11-15-terminal-native-agent-restore.md),
[scheduled handoff](2026-11-15-terminal-native-task-handoff.md) and
[inactive capture](2026-11-15-terminal-native-inactive-capture.md).

## Ordinary live history trim accepted

The authoritative ignored M2 receipt is
.terax/pi-development/m2/logs/history-live-2d869a3/ordinary-history-acceptance.json
in the qa worktree, completed 2026-11-16T06:09:19.497Z. It binds the case to
packaged source 2d869a3, app PID 5217, owned ordinary tab 40 and shell 61416.

The selected public fixture shrank from 2307 to 2040 copied lines after the live
history reduction, without reselecting. The old marker disappeared and the kept
marker remained. Before trim, the old search match had 7364 active-highlight
pixels and local OCR found its marker. After trim and Enter, the old query had
zero active and zero inactive highlight pixels; local OCR no longer found it.
A fresh kept-marker query had 7785 active pixels and local OCR found that marker.
These are scoped visual and text outcomes, not claims about every possible
history/reflow layout or an inaccessible internal cursor state.

Only numeric/boolean evidence and metadata crossed from M2. Terminal PNGs stayed
on M2, and no raw clipboard contents enter this report. Each clipboard check
restored the full original pasteboard. The effective history preference was
restored to 2000, with the formerly implicit default now explicitly stored.
The owned tab and shell exited. All 13 original tabs, active tab 35, three editors
and original shell PIDs 5549/5550 were preserved.

After closing Settings, an AXFocusedUIElement read and SetFocused request did
not establish successful keyboard delivery. A physical click on the observed
control with explicit empty modifier flags, followed by Cmd+F and literal input,
did establish it. Internal first-responder state was not directly observed.
This is an automation limitation, not an established product defect.

This closes the ordinary selection/search live-trim case. Blocks trim,
block-output/header invalidation and the other preferences remain open.

## Platform and rollout boundaries

The app's minimum macOS version is 13.0 in
[src-tauri/tauri.conf.json](../../src-tauri/tauri.conf.json), also at the audited
baseline 0c573d8. It was not lowered or raised by this migration. Earlier report
references to app 10.15 or mandatory app 11 acceptance were inaccurate.
The verified extended arm64 core declares minimum 11.0, which is compatible with
the app's 13.0 minimum. Runtime on the supported minimum is still distinct from
Mach-O object inspection; unsupported macOS 11 is not a new app gate.

The [native-core consumer](2026-11-15-terminal-native-core-consumer.md) is a
verified local arm64 macOS artifact. Intel/Linux/Windows need matching extended
ABI artifacts and actual target acceptance before native enablement there.
Canonical publication remains separate and is not authorized by this report.
The current ConPTY 50 ms drain guard does not prove complete final-output,
quick-exit or descendant cleanup. Release panic=abort also differs from the
tested dev unwind behavior. The original bundle-growth requirement still needs
comparable artifact evidence at rollout, not an invented result from archive
size.

Keep the fallback and sandbox opt-in. After functional parity, switch the dev
default and validate the user's real workload with 10+ split tabs and many agent
panes over days; release/default removal follows its applicable gates.
The [user priority](2026-11-14-terminal-migration-priority.md) explicitly removes
60 FPS as a gate and defers further performance laboratories. Historical
negative measurements remain unchanged; they do not block this functional work.

Bash authoritative full-command metadata is absent in both engines, as the
[compatibility evidence](2026-11-15-terminal-native-bash-metadata.md) establishes.
Do not invent a migration regression or timing/history workaround for it.
Cross-cell ligatures remain conditional; neither a ligature addon nor
screenReaderMode was enabled in this baseline.

## Tool readiness and checkpoint scope

Codex 0.169.0 was separately staged from the official distribution, verified for
integrity, OpenAI signature and notarization, and activated reversibly on M2.
Bounded version/help checks pass and the existing ChatGPT authentication status
is positive. Tool receipts remain outside repository source. No model request
or agent turn was sent, so this enables the next cases without closing A07-A10.
No credential, private session or raw clipboard data is recorded here.

[Pi-Terax/GraphX acceptance](2026-11-16-pi-terax-graphx-acceptance.md) closes that
feature's listed M2 cases, not the terminal migration. This documentation slice
ran no UI, bridge, model call, Cargo, app build or test suite. Validation is
limited to diff/links/scope checks. Concrete product failures return to atomic
worktrees; accepted broad floors are not repeated without cause.
