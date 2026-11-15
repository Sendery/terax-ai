# Native terminal file drops

## Problem and behavior

The shared OS drag-and-drop hook receives physical positions from Tauri. Its
viewport overflow heuristic left some physical coordinates unscaled whenever
they still fit inside the CSS viewport. On a Retina split, a physical point
(600, 200) in an 800 by 600 CSS viewport could target the right split instead
of CSS point (300, 100) in the left split.

The hook now converts every enter, over and drop point using the current
device pixel ratio before DOM hit testing. The shared data-pane-leaf wrapper
identifies both native and legacy panes. Drop location is resolved again for
the actual drop, independent of the previous hover target, and display-scale
changes are read per event. Outside-pane and empty drops remain ignored.
Listener callbacks are inert after disposal even while async registration has
not yet delivered its unlisten function.

The existing formatDroppedPaths and pasteIntoLeaf route is preserved. Quoted
Unicode and metacharacter paths reach the chosen leaf's native paste adapter,
which keeps the negotiated native paste policy. This change adds no file
reads, clipboard access, shell execution, native command, persistence state,
dependency or per-frame work.

## Evidence

Source base db918d035eff82639c442bb1788936679d44573f in the isolated M2
native-filedrop worktree. The installed Tauri api/webview.d.ts declares
PhysicalPosition for enter/over/drop; webview.js constructs that same type.

The hook regression suite reproduced three failures before the production
change: Retina target selection, current-scale hover, and late disposed
callbacks. Five hook cases now pass alongside the six existing shell quoting
cases. Coverage includes scale-one behavior, fractional/current scaling, a fresh
drop location, Unicode and literal shell metacharacters, empty/outside drops,
leave cleanup and delayed listener registration disposal.

Commands:

- pnpm exec vitest run src/modules/terminal/lib/useTerminalFileDrop.test.ts src/modules/terminal/lib/quoteShellPath.test.ts
- pnpm check-types
- pnpm exec biome lint src/modules/terminal/lib/useTerminalFileDrop.ts src/modules/terminal/lib/useTerminalFileDrop.test.ts
- git diff --check

All source work and TS checks ran on M2. This lane did not run Cargo, a native
build, runtime UI automation, benchmarks, GitHub Actions or publication. Root
coordinates native builds and real drag-and-drop acceptance sequentially with
the other worktrees. Unit hit testing does not prove the native window manager
or physical mixed-display interaction. Windows shell-quoting semantics and
platform runtime acceptance are not expanded or claimed by this change.
