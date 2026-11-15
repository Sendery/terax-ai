# Native links in ordinary terminal panes

Ordinary native panes now open URLs, OSC 8 targets and local files through the
normal app routes. File links support spaces/quotes and one-based line/column.
This is another opt-in migration slice, not completion of terminal replacement.

## Behavior and boundaries

Native snapshots retain bounded immutable metadata for three presented frames.
The click uses the frame the user saw even if later output changes the core.
Unchanged rows share storage; no new frame format or idle polling is introduced.
Soft-wrap context, full grapheme text for lookup and UTF-16 cell mapping are
independent of the still-incomplete V1 grapheme renderer. Clipped raw tokens,
unavailable rows, oversized URI data and unsupported OSC 8 schemes fail closed.

The frontend rechecks owner, source and availability around asynchronous work.
Primary click, including Cmd-modified click, opens a valid target. Drag selection,
secondary click, disposal and source replacement do not. File metadata is checked
fresh, but fs_stat is not authorization: human editor reads and AI filesystem/
command authorization retain their existing distinct routes. No link/terminal
text is added to Pi snapshots or command surfaces.

Real acceptance also corrected existing interaction races: primary pointer
default stealing textarea focus; deferred tab updaters returning null before
activation; CodeMirror becoming ready before its view exists; and consuming a
hidden editor's pending location before React commits activation. A separate
committed-ID ref prevents optimistic bridge focus from claiming visibility.

## Verification

Worktree: /Users/andres.rojo/Workspaces/terax-worktrees/native-links.
Branch: feat/native-terminal-links. Clean base: 4f6130d.
All execution/build/UI work ran on M2 with the verified provisional prebuilt
archive and source fallback denied. No GitHub Actions, protected-Mac build,
push, merge or new FPS/performance laboratory ran. Sendery is the commit identity.

Final full gate status: all listed commands passed on M2 (links-acceptance logs). Frontend: 2444 passed and one existing skip; Pi: 101; Node: 43. Plain Rust: 595 unit plus 58 integration, one ignored. Native Rust: 696 unit plus 58 integration, two ignored. Strict clippy passed in both modes. Baseline and final lint each report 120 warnings and two infos; diagnostic-by-path/rule/message comparison found no new diagnostics.

Commands in .terax/pi-development/m2/check-credit-iteration.sh:

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

Native checks use the shared M2 target sequentially with the owned dev watcher
stopped. Node policy tests retain worktree cwd and no global CARGO_TARGET_DIR.
Initial source baseline and prior full iterations passed. Red-before-fix logs
cover metadata/clipped edges, client resolution, activation/lifecycle, deferred
tabs, geometry and primary focus. No checks, assertions or lint rules were
suppressed. Independent code review found the clipped edges, geometry and tab
race, then the optimistic-active-ID issue; all were corrected.

Real authenticated bridge and OS gestures proved:

- Relative target.txt:12:3 opens a newly mounted persistent editor. A typed/saved
  marker appeared exactly at line 12 column 3.
- Cmd-click of "My Target.ts":20:4 opens a quoted filename with spaces. Its marker
  appeared exactly at line 20 column 4.
- OSC 8 local file URI with #L15C5 reuses a hidden editor and gives it keyboard
  focus. Its saved marker appeared exactly at line 15 column 5.
- Plain URL, OSC 8 URL and a URL split across a 44-column pane each reached a
  different known path on an owned 127.0.0.1 HTTP receiver exactly once. No browser
  screenshots or private data were collected.
- Dragging a selection, opening its native app context menu and clicking a
  javascript OSC 8 label did not increase those receiver counts or open an editor.
- After a one-pixel divider move, the first click in the inactive static-output
  pane opened the correct existing editor. A final marker/save proved L12C3 with
  the committed-activation guard.
- Invalid bridge focus was rejected with unchanged structural state.

Markers were undone and saved. Public fixtures, failed attempts and exact logs
remain in ignored .terax/pi-development/normal-links and m2/logs.
The inspected captures include:

- .terax/visual-qa/20261115T052525.758Z-links-file-location-fixed-KqeFpb/screenshot.png
- .terax/visual-qa/20261115T053132.921Z-links-existing-editor-fixed-JtuPUh/screenshot.png
- .terax/visual-qa/20261115T053156.583Z-links-context-menu-xwT3j7/screenshot.png
- .terax/visual-qa/20261115T053527.400Z-links-resized-hover-TCSCU9/screenshot.png
- .terax/visual-qa/20261115T053902.640Z-links-wrapped-final-AtUvRr/screenshot.png

The editor markers, context-menu content, split divider and wrapped URL were
visually inspected. Hover-pixel proof remains open: app.capture composites native
canvas pixels after the DOM clone, covering DOM hover/preedit overlays in the
artifact. Binding/coordinator tests cover hover paint and invalidation; the absent
captured underline is not evidence that the displayed DOM underline is absent.
A background capture also timed out after external-browser activation; the same
live sandbox succeeded after returning to the foreground. Neither case was
treated as process failure or used to restart a live job.

## Remaining migration

T11 remains open for other-platform runtime acceptance and hover/capture-overlay
proof. No M2 result establishes Windows/Linux behavior or full grapheme rendering.
Blocks/drafts/anchors, TUI mouse/readline, OSC clipboard/notifications, remaining
preferences, selection-action consumers, offscreen/overlay capture, agent/task/
restore acceptance, graphics/HiDPI, default rollout and soak remain in the parity
inventory. FPS remains optional; the full goal remains active.
