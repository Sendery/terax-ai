# Native terminal acceptance status

The active goal is a usable Terax with the new terminal and the same or better
existing capabilities. It is not complete. This checkpoint starts from local qa
3228447f7731420c8a0bcda6b2ba8717651baf57, the packaged source used for the
current Codex acceptance. Cursor and earlier cases retain their own b65c960
and 2d869a3 artifact provenance below.
This update changes documentation only.

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
| 1. History and preferences, T08/T09 | Physical Cmd+K preserves the PTY; font size and letter spacing update visible and hidden panes. Ordinary live trim preserves the clipped selection and invalidates the old search result. Block live trim invalidates evicted search and preserves retained-block search. Menlo plus Semi-Bold changes pixels; restoring empty family and Normal recovers the exact original PNG. On the corrected native b65c960 artifact, GPU and software cursors blink while focused and remain visibly hollow and stable after pane or window blur; restoring blink off is stable. On native 3228447, Kanagawa persists with the Codex pane visible, and 110 percent zoom keeps its composer legible; both restore to their originals with the same PTY. | Other unavailable block-output/header cases; remaining theme/settings combinations and image-background contrast. These scoped cases do not establish all settings or all font combinations. |
| 2. Keyboard, composition and paste, T02/T03/T04 | Real peer proves Kitty press/repeat/release, Shift+Enter and focus reports. Real Pi preserves a multiline draft through hide/continue. One physical Spanish-ISO dead-key case, keycodes 39 then 0, delivers exactly UTF-8 c3a1 once with no Enter. OSC52 system-clipboard cases are accepted separately. | CJK composition and candidate-confirming Enter remain untested because a CJK input source was not enabled; broader dead-key/composition cases, actual multiline paste with/without negotiated brackets, and remaining real Claude/Codex navigation, composition and redraw remain open. The scoped three-line Codex task handoff is recorded in category 6. |
| 3. Pointer, links and file drops, T05/T11/T12 | SGR cell/pixel reports, alternate-screen wheel and short Alt-click are accepted. Earlier native-link cases cover plain/OSC8/wrapped URLs and quoted file line/column routing. | Actual OS file drop to both splits with Unicode/space/metacharacter paths; word/line/rectangle selection, off-pane autoscroll and selection-preserving right-click; remaining hover-overlay and physical DPI cases. |
| 4. Selection, AI and app consumers, A04/A10/A14 | Native popup Add to Note is accepted after the semantic-revision correction. Cmd+A/right-click Open Mermaid preserves the exact 54-character normalized selection and renders the known nodes in the preview. Async context/selection and owner/privacy adapters are implemented. | TTS, Ask Terax and block attachment with the captured selection; bounded active/history AI context and managed-agent input; privacy/owner changes during pending work. |
| 5. Blocks, A02 | Independent drafts, foreground input, scoped Find/next/Escape, Unicode output copy, rerun and controls after reveal were exercised in the block-overlay slice. The general sweep verifies complete multiline copy and once-only rerun. A 412-character command copies completely; live trim rejects the evicted block search while retained-block search still works. | Wrapped header geometry, empty/overwritten output and other actions on unavailable block output. Blocks splitting remains disabled as in baseline. |
| 6. Agents, restore and handoff, A07/A08/A09 | Owner-bound capture, readiness/submission and task-delivery logic have directed source tests. Real Pi hide/continue is accepted. On native 3228447, Codex is detected in its owned monitor row before a turn. One manual three-line task reuses that target and runs exactly once. An actual Always-policy restart restores one Codex TUI in its CWD; a second gpt-6.1-sol turn recalls the earlier context without repeating its identifier in the question. | Remaining split activity/attention/exit; timer-driven delivery, unavailable/unchanged buffers and retry/owner cases. Task-to-tab persistence across restart remains a separate baseline follow-up. Terax AI context consumers and authenticated Claude remain open; these Codex cases do not establish the whole scheduled lifecycle. |
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

The historical blurred-cursor observation produced two states and its receipt
sets blurBehaviorAccepted to false. It remains unaccepted on that artifact.
The later corrected native artifact is accepted separately below.
No theme, zoom, background-contrast or other font-combination acceptance is
inferred from these cases.

All 13 original tabs and their exact metadata, plus original shell PIDs
5549/5550, were preserved. The owned peer, shell and tab were retired.

## Corrected native cursor blur accepted

Source correction 774ba0e48df3a82e563325fce9dc95cab3a5ff74 was integrated as qa
b65c96012b89f32127641e075d9beaf983645bd9. Its five new behavior regressions
failed against base source; all 46 focused tests, TypeScript, touched-file
lint/format and diff checks passed after correction. Independent source review
is supporting evidence; the separate runtime receipt below establishes the
scoped visual outcome.

The authoritative ignored M2 receipt is
.terax/pi-development/m2/logs/cursor-blur-native-b65c960/acceptance.json,
completed 2026-11-16T07:58:28.388Z. App PID 61121 used the full-commit candidate
.terax/qa-candidates/b65c96012b89f32127641e075d9beaf983645bd9/Pi-Terax Sandbox.app
in qa, with executable SHA256
c56ae98f326930fdfe61a0741762a505c0cba9e98ee78513b120204b1c46a19a.
The frontend choice was explicitly ghostty and the native feature was
ghostty-engine. The separate short-directory b65c960 candidate selected xterm;
it was invalid for native acceptance and supplies none of this evidence.

With actual UI bounds matched, the cursor rectangle was [63, 197, 80, 234].
Focused GPU and software series each alternated between 629 and zero painted
pixels. Pane blur and actual window deactivation each retained a visible hollow
cursor at 288 pixels in all five samples, in both renderers. This is scoped
physical acceptance of the corrected behavior, separate from AX focus metadata.

The same PTY survived GPU to software to GPU. Original preferences were restored
to GPU enabled and cursor blink disabled, with the off cursor stable in one
state. All 13 original tab metadata and shell PIDs 61466/61467 were preserved.
Owned tab 40, shell 83756 and peer 84374 were retired; unexpected PTY input was
zero. This cursor case does not establish theme or zoom; the later scoped
3228447 checks are recorded below. Other settings and platform/default gates
remain open.

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

## Native Codex detection and first task accepted

Native preexec changed from a raw command to authenticated aid/cmdline_url
metadata, while the shared agent detector still expected the raw form. This
regression hid a running Codex TUI from the monitor/store before any turn;
a first model turn was never the start contract. Qa 683a63a binds detection to
the same shell token, validates a unique aid and reuses the strict decoder.
Qa 3228447 also shares the native shell parser's encoded OSC 133 budget:
a 3024-byte legacy-valid command remains detectable after encoding beyond
8 KiB. Legacy and other OSC retain 8 KiB; oversized markers are discarded
whole, and decoded commands retain their existing 1 MiB limit.

The corrections passed independent source review, 37 then 42 focused detector
tests, strict plain Clippy and touched-file formatting. The additional native
budget regression was red first; the actual zsh fixture proved both legacy
detection and exact core decoding before the detector fix. These source checks
are distinct from the real packaged acceptance below.

The ignored M2 receipts are under
.terax/pi-development/m2/logs/codex-acceptance-3228447/:
first-turn-acceptance.json, monitor-owned.json, task-created.json and
task-state.json. They bind this case to packaged source
3228447f7731420c8a0bcda6b2ba8717651baf57, app PID 26283, owned tab 40,
shell 24043 and Codex PID 24677, in
/private/tmp/terax-codex-acceptance-20261116.

The monitor showed one Codex row belonging to the owned tab. A manual task
created through app commands sent three lines to that existing target and
ran exactly once, with no duplicate agent process. The expected response marker
TERAX_NATIVE_TASK_OK appeared twice, in user and assistant content; the first
response was observed and the task returned idle. The successful turn used
gpt-6.1-sol, with no authentication or model error.

An earlier gpt-5.2-codex selection was unsupported by the current ChatGPT-backed
CLI. Selecting the available gpt-6.1-sol through Codex recovered the turn;
this was a CLI model-availability boundary, not a Terax authentication defect.
This first-turn case alone does not establish startup restoration. The later
real restart and recalled conversation context are accepted below. Terax AI
context consumers, remaining agent lifecycle/timer cases and authenticated
Claude remain open.

## Scoped theme and zoom accepted with Codex

The ignored M2 receipt
.terax/pi-development/m2/logs/codex-acceptance-3228447/theme-zoom-acceptance.json
binds this case to source 3228447, app PID 26283 and owned tab 40. Selecting
Kanagawa through the real Settings UI persisted the theme ID and kept the
native Codex composer and response visible. The original terax-default theme
was restored.

Real arrow keys on the focused General zoom slider selected 110 percent.
The native composer remained legible, and zoom was restored to 100 percent.
The same PTY and Codex PID 24677 survived both preference changes; captures
remain local to M2. An earlier AXSetValue attempt changed no state and was
corrected in the ignored helper, with no demonstrated product failure.

This accepts those two settings transitions only. Complete image/background
contrast, other theme combinations and CJK composition remain unaccepted.

## Codex startup restoration and conversation context accepted

The final ignored receipts in the same codex-acceptance-3228447 directory are
acceptance.json and restored-context-classification.json. The final acceptance
completed 2026-11-16T10:10:40.223266+00:00 and reports passed true. The actual
Always-policy startup restarted app PID 26283 as PID 92065 using the same
3228447 executable, SHA256
b3c762f913e562038c065ca50b0c4a5f44b4807ba3f653b3901f5fc79c8d69f0.

Exactly one restored Codex TUI used the owned CWD. The tab moved from ID 40 to
41 while retaining index 13: existing workspace hydration allocates new IDs,
so this is not evidence of persistent numeric tab identity. A second successful
gpt-6.1-sol turn recalled TERAX_NATIVE_CONTEXT_20261116 from the earlier
three-line prompt without the identifier being repeated in the question.
The assistant response region was verified locally, including OCR wrapped at
width 462; the classification reports assistantRegionContextVerified true
with no authentication, model, usage-limit or request failure. Captures stayed
on M2.

The task's run count stayed exactly one before and after restart; no extra
Codex TUI was observed. Its old tabId 40 link was not accepted as persistent.
This is pre-existing behavior in the xterm baseline 0c573d8 and 03a44af:
[workspace hydration](../../src/modules/spaces/lib/serialize.ts) allocates IDs,
[task serialization](../../src/modules/tasks/lib/store.ts) retains tabId, and
[ensureTaskTab](../../src/app/App.tsx) creates a new tab when that ID is absent.
The owned task had exhausted maxRuns 1 and was not rerun. Persistent task
linkage needs a separate follow-up; it is not a native migration regression.

Cleanup retired the owned task, tab, Codex and shell. All 13 original tabs'
public metadata, three clean editors and the graph's identity, revision and
source were preserved exactly. Recovery policy Ask, theme terax-default and
zoom 100 percent were restored. The current app remains PID 92065 with original
fixture zsh PIDs 43247/43246. This accepts the scoped A08 Codex startup/CWD and
conversation-context case, alongside the first manual task; it does not accept
all agents, task-link persistence, Terax context tools or total terminal parity.

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
composer was not ready at that earlier checkpoint.

That startup check sent no model turn and added no task. Its original tabs
were preserved; only owned tab 44 and its shell were retired. The later
3228447 first-turn/manual-task and actual Codex startup/context cases are
accepted separately above. Broader A07-A10 cases and persistent task linkage
remain open. No credential, private session or raw clipboard data is recorded
here.

[Pi-Terax/GraphX acceptance](2026-11-16-pi-terax-graphx-acceptance.md) closes that
feature's listed M2 cases, not the terminal migration. This documentation slice
ran no UI, bridge, model call, Cargo, app build or test suite. Validation is
limited to diff/links/scope checks. Concrete product failures return to atomic
worktrees; accepted broad floors are not repeated without cause.
