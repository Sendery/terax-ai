# Native clear-active shortcut

Date: 2026-11-15. Base: `a27ea8f4cce7914b4ec58bd13703c706f25a05dc`.
Branch: `feat/native-terminal-clear-shortcuts`.

## Delivered

The existing `terminal.clearActive` shortcut, Mod+;, sends the same
single formfeed (Ctrl+L) to the focused native terminal. Previously its App
guard recognized only `.xterm`, excluding the native input surface.

The facade checks the actual active element, exact native leaf, input textarea,
live owner, active view and direct-input policy. Captured owned input revalidates
ownership, focus and policy through the final native write guard. Moving to an
editor, replacing the process, closing the pane or returning to the blocks
prompt while a write waits cancels the obsolete operation. Genuine write errors
are handled by the App caller without retry.

Legacy terminals retain the formfeed behavior and require their actual focused,
visible slot. Manual input in private terminals remains allowed. No terminal
contents are read and no capture or public bridge capability is added.

## Verification

On M2, with Node 24 and cached pnpm 11.5.0:

```sh
PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin \
  ./node_modules/.bin/vitest run \
  src/modules/terminal/lib/sessionSubmissionFacade.test.ts \
  src/modules/terminal/gl/nativeLeafSession.test.ts \
  src/modules/terminal/gl/nativeInputBinding.test.ts \
  src/modules/terminal/gl/engineSession.test.ts \
  src/modules/shortcuts/shortcuts.test.ts
```

145 tests pass across five files. The new cases include the actual global
shortcut dispatcher, correct native and legacy targets, editor/other-pane
fallthrough, disabled/prompt input and delayed owner/focus/policy cancellation.
Fourteen new cases were red before implementation; eight existing facade tests
passed. The initial red was absence of the new facade operations, not a claim
that the old App executed native input. Fixtures were subsequently made
compatible with the optional input guard and mutable exit state.

`tsc --noEmit`, focal Biome lint and `git diff --check` pass.
App has ten unchanged baseline lint warnings, compared by diagnostic category
and message using the same rules and an isolated copy of HEAD. No full app
build, Cargo, UI or performance run was made. Astra reviewed source and found no
concrete blocker. Real Mod+; acceptance in normal, blocks-program and legacy
panes remains pending.

## Cmd+K host clear remains pending

`terminal.clear` is a separate existing action. It still calls
`clearFocusedTerminal`, which is legacy-only. This checkpoint does not
replace its semantics with Ctrl+L.

Installed xterm 6.0.0 `CoreBrowserTerminal.clear` returns early when
`ybase === 0 && y === 0`. Otherwise it retains the entire cursor row as
row zero, including its cells and styles; keeps X; sets Y, history and viewport
origin to zero; fills remaining rows with default attributes; and disposes all
markers in the active buffer. In the alternate screen the same operation applies
only to that active buffer, leaving the primary screen intact.

Verified upstream Ghostty source `a887df42c56f6de86c0fe6da9c4eeca37931e083`
was read from the cursor-settings lane. Git blob hashes for Terminal, Screen,
PageList and the C header match its download manifest. The C header has no
equivalent host-clear operation. VT eraseDisplay is unsuitable: it can use the
current background, respect protected cells, invoke prompt scrolling, and reset
pending wrap; reset would also discard modes and other terminal state.

A future additive core host operation should implement the exact active-buffer
contract directly, preserving the retained row's managed graphemes, hyperlinks,
styles, X and wrap/mode state. Screen.eraseHistory and eraseActive can remove
prefix rows, but their tracked-pin clamping must not make deleted anchors point
at retained content. Deleted search/block references must become unavailable,
while unrelated inactive-buffer references remain valid. Default blank rows,
viewport reset, dirty-frame publication and allocation failure need explicit
tests. This is a source-grounded proposal, with no producer/API implementation
or compilation in this block.
