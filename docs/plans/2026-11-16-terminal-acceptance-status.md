# Native terminal acceptance status

The active goal is a usable Terax with the new terminal and the same or better
existing capabilities. It is not complete. This checkpoint audits local qa
b65c96012b89f32127641e075d9beaf983645bd9 and the actual packaged source
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
| 1. History and preferences, T08/T09 | Physical Cmd+K preserves the PTY; font size and letter spacing update visible and hidden panes. Ordinary live trim preserves the clipped selection and invalidates the old search result. Block live trim invalidates evicted search and preserves retained-block search. Menlo plus Semi-Bold changes pixels; restoring empty family and Normal recovers the exact original PNG. Focused cursor blink has two states when on and one after restoring off. | Other unavailable block-output/header cases; cursor behavior on blur/focus, zoom, theme and image-background contrast. The blurred-cursor case is explicitly not accepted; a separate GPU/software source correction is not runtime acceptance. These scoped cases do not establish all settings or all font combinations. |
| 2. Keyboard, composition and paste, T02/T03/T04 | Real peer proves Kitty press/repeat/release, Shift+Enter and focus reports. Real Pi preserves a multiline draft through hide/continue. One physical Spanish-ISO dead-key case, keycodes 39 then 0, delivers exactly UTF-8 c3a1 once with no Enter. OSC52 system-clipboard cases are accepted separately. | CJK composition and candidate-confirming Enter remain untested because a CJK input source was not enabled; broader dead-key/composition cases, actual multiline paste with/without negotiated brackets, and real Claude/Codex navigation, multiline and redraw remain open. |
| 3. Pointer, links and file drops, T05/T11/T12 | SGR cell/pixel reports, alternate-screen wheel and short Alt-click are accepted. Earlier native-link cases cover plain/OSC8/wrapped URLs and quoted file line/column routing. | Actual OS file drop to both splits with Unicode/space/metacharacter paths; word/line/rectangle selection, off-pane autoscroll and selection-preserving right-click; remaining hover-overlay and physical DPI cases. |
| 4. Selection, AI and app consumers, A04/A10/A14 | Native popup Add to Note is accepted after the semantic-revision correction. Cmd+A/right-click Open Mermaid preserves the exact 54-character normalized selection and renders the known nodes in the preview. Async context/selection and owner/privacy adapters are implemented. | TTS, Ask Terax and block attachment with the captured selection; bounded active/history AI context and managed-agent input; privacy/owner changes during pending work. |
| 5. Blocks, A02 | Independent drafts, foreground input, scoped Find/next/Escape, Unicode output copy, rerun and controls after reveal were exercised in the block-overlay slice. The general sweep verifies complete multiline copy and once-only rerun. A 412-character command copies completely; live trim rejects the evicted block search while retained-block search still works. | Wrapped header geometry, empty/overwritten output and other actions on unavailable block output. Blocks splitting remains disabled as in baseline. |
| 6. Agents, restore and handoff, A07/A08/A09 | Owner-bound capture, readiness/submission and task-delivery logic have directed source tests. Real Pi hide/continue is accepted. Official Codex 0.169.0 starts in the native TUI with the correct CWD; exact positive login status in the same PTY is recorded, but onboarding remains visible and its composer is not ready. | Real split activity/attention/exit; correct conversation/CWD restoration once after readiness; multiline scheduled delivery once, with unavailable/unchanged buffers never reported as success. Codex has no model turn or task-delivery acceptance and awaits user action on M2. Neither Pi draft persistence nor Codex startup establishes these cases. |
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

This closes the ordinary selection/search live-trim case. The subsequent block
case is recorded below; other preferences and block-output/header cases remain
open.

## Block live history trim and long command accepted

The authoritative ignored M2 receipt is
.terax/pi-development/m2/logs/block-history-2d869a3/block-history-acceptance.json
in the qa worktree, completed 2026-11-16T06:39:36.755Z. It binds the case to
packaged source 2d869a3, app PID 5217, owned block tab 42 and zsh PID 88880.

The old block search showed 1/1 before trim. After trim it returned
"Block search is no longer available." with zero results. The retained block
still returned 1/1; local OCR found its known marker and did not find the old
marker. Copy command preserved the full 412-character command. The four finite
fixtures (old, fill, keep and after) each executed once.

The original clipboard was restored, effective scrollback returned to 2000,
and the exact metadata of all 13 original tabs and shell PIDs 5549/5550 were
preserved. Owned tab 42 closed and zsh PID 88880 retired.

Earlier HID wheel/blocks-next attempts did not reveal the latest header;
a new finite command's auto-follow did. The independent geometry audit confirmed
that capture used the correct pane wrapper and shared-canvas crop. Wheel input
had targeted the editor/overlay, and Cmd+Down was not native scrolling. The
explicit tab 42 capture then showed the kept marker and no old marker. These
automation attempts do not establish a product scrolling defect.

This accepts the scoped block-search eviction/retention and long-command copy
cases. Wrapped header geometry, empty/overwritten output, other actions on
unavailable block output and the broader categories remain open.

## Live font, cursor and Spanish dead-key cases accepted

The authoritative ignored M2 receipt is
.terax/pi-development/m2/logs/preferences-native-2d869a3/acceptance.json in the qa
worktree, completed 2026-11-16T07:03:58.384446+00:00. It binds these cases to
packaged source 2d869a3, app PID 5217, owned tab 46, shell 48007 and peer 59640.

Physical Spanish-ISO keycodes 39 then 0 delivered one UTF-8 c3a1 commit, with
no Enter delivered. This accepts that dead-key accent case only. A CJK input
source was not enabled, so CJK composition, candidate-confirming Enter and
broader IME behavior remain unaccepted.

Selecting Menlo and Semi-Bold changed the terminal PNG. Restoring the original
empty font family and Normal weight recovered the exact original PNG. Focused
cursor blinking on produced two states confined to a 17 by 37 pixel cursor
rectangle; restoring the original off preference produced one state.

The blurred-cursor observation produced two states and the receipt explicitly
sets blurBehaviorAccepted to false. Blur/focus behavior remains open. A separate
GPU/software source correction is not integrated runtime acceptance here.
No theme, zoom, background-contrast or other font-combination acceptance is
inferred from these cases.

All 13 original tabs and their exact metadata, plus original shell PIDs
5549/5550, were preserved. The owned peer, shell and tab were retired.

## Selection to Mermaid accepted

The authoritative ignored M2 receipt is
.terax/pi-development/m2/logs/selection-consumers-2d869a3/acceptance.json
in the qa worktree, completed 2026-11-16T07:29:31.954Z. This case exercised
packaged source 2d869a3 and app PID 5217, not the newer cursor correction.

Cmd+A followed by right-click and Open Mermaid preserved the selected fixture:
the normalized source matched exactly, with 54 characters. Preview reported
up to date. Local OCR found both known nodes in the preview region starting at
45 percent of the image width; source-editor text was excluded from that proof.
The action accessed no clipboard and produced no unexpected PTY input.

Ask Terax opened its panel, but that configuration had no available composer;
the panel was closed again. No attachment was attempted and no model turn was
submitted. Speech had neither an installed engine nor a downloaded model, so
TTS was not attempted. Those consumer cases remain pending.

All 13 original tabs and their exact metadata were restored. Owned terminal 48,
diagram 50 and processes 54247/54839 were retired. This accepts selection to
Mermaid only; it does not close the selection/AI consumer category or the goal.

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
Bounded version/help checks pass. The ignored M2 receipt
.terax/pi-development/m2/logs/codex-native-2d869a3/startup-result.json, completed
2026-11-16T06:50:48.140717+00:00, records native TUI startup and the correct CWD.
A bounded login-status probe in that same PTY exited zero and matched the exact
positive ChatGPT status. Nevertheless, onboarding remained visible and the
composer was not ready. User action on M2 remains pending.

No model turn was sent and no task was added. Conversation restoration,
multiline handoff and functional Codex turns are not accepted by startup or
authentication status. Original tabs were preserved; only owned tab 44 and its
shell were retired. This leaves A07-A10 open. No credential, private session or
raw clipboard data is recorded here.

[Pi-Terax/GraphX acceptance](2026-11-16-pi-terax-graphx-acceptance.md) closes that
feature's listed M2 cases, not the terminal migration. This documentation slice
ran no UI, bridge, model call, Cargo, app build or test suite. Validation is
limited to diff/links/scope checks. Concrete product failures return to atomic
worktrees; accepted broad floors are not repeated without cause.
