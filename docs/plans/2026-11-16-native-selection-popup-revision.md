# Native selection popup revision correction

The first combined real popup click exposed a source defect in the initial
selection popup patch: it appeared and kept the marker highlighted, but Add to
Note dismissed it without adding a note. The notes.list oracle reads the same
tab notes as the action.

NativeLeafSession refreshes retained selected text after frames using
EngineSession.select(read). That read advances the existing query/cache
revision, which the initial popup treated as a semantic selection mutation.

EngineSession now exposes a separate selectionMutationRevision. The popup
uses that token; existing selectionRevision, request ordering, cache
supersession and Alt-click/block-click stale-query guards remain unchanged.
Repeated reads with identical selected text preserve the popup token.
Mutating selection commands, block selection, changed/clipped text discovered
by a read, unavailable selection, history invalidation/clear and retirement
advance it. Existing owner, hide, privacy, gesture and exact-original-text
checks remain in force.

The focused regression uses the actual EngineSession class and existing
mocked IPC boundary together with the popup controller. It releases a
selection, performs repeated real select(read) calls and invokes the popup
action, while proving that query revisions still advance. Other cases cover
selection commands, clipping, failed reads, history shrink/clear, block
selection/search cleanup and close. The DOM binding regression separately
proves that popup validity ignores a read-only query revision but rejects a
semantic mutation.

All operations ran in the isolated M2 native-selection-revision worktree from
ced062b. No UI, native build, Cargo, producer, performance lab, Actions, push,
PR, merge or publication ran. Root owns the directed combined-candidate
visual click acceptance after integration; logical tests do not claim it.


## Focused checks

The baseline128 tests passed. Six new EngineSession ownership regressions failed
before implementation. The final run passed138 tests in four files, including
the actual EngineSession and popup controller. TypeScript passed. Biome check
passed for the four affected source/test files with two unchanged pre-existing
non-null-assertion warnings. git diff --check passed.
