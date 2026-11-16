# Capture current select state

The shared rasterizer now freezes each select option's current selectedness
into selected attributes on the detached clone before XML serialization.
Stale default attributes are removed. Selection is copied by index, preserving
duplicate option values and multiple selection.

A single-line dropdown explicitly set to no selection gets one empty hidden
selected option at the end of the clone only. Reparsed HTML would otherwise
select its first real option. Appending preserves source/clone child alignment
during computed-style freezing. Empty dropdowns and unselected listboxes need
no placeholder. The live DOM and original options are never changed; no
untrusted HTML is evaluated.

The baseline 20 rasterizer tests passed. Six new select regressions failed
before the fix; the final focused run passed 42 tests in rasterize, capture and
frameCapture. TypeScript, Biome check of the two affected module files and
git diff --check passed without new diagnostics.

The tests exercise the actual rasterizeElement pipeline with controlled DOM
fixtures and inspect its frozen clone at XML serialization. They do not claim
real browser pixels. Root owns the directed app.capture PNG acceptance after
integration.

All work ran in the isolated M2 capture-select-state worktree from 04bf58a.
No GraphX/CSP/App, UI/bridge, native build, Cargo, producer, Actions, push, PR,
merge or publication operation ran in this lane.
