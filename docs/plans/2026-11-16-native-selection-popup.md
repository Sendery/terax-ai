# Native selection action popup

The native terminal now uses the existing selection action popup after a
primary selection, matching the legacy terminal and editor affordance. The
context menu retains its independently frozen selection.

Native pointer release supplies the actual selection completion promise,
including a subsequent block selection. The pane adapter binds the gesture to
its session, leaf, visible state and privacy scope. The popup waits for that
completion without a timer, then checks the same selected text before showing
or invoking Ask Terax, Add to Note or Open Mermaid.

Later pointer interaction, owner retirement, history invalidation, wheel
navigation, cancellation and failed selection reads cannot revive an old popup
or act on replacement text. An older completion or rejection cannot clear a
newer popup. Healthy exited panes retain their selection actions. Legacy and
editor selections keep their existing deferred finalization path.

Popup buttons are disabled during their closing animation, and a dismissed
native popup cannot invoke a second action.

No persistence, native ABI, IPC, command, Pi surface or dependency changed.
Private manual selection behavior is preserved; this does not automatically
send selected text to an AI service.

## Focused verification

The implementation began with six failing native gesture regressions against
the unchanged base. The existing three input tests and TypeScript passed
before editing. Focused verification covers native binding, popup ownership,
hook event wiring, the existing popup component and neighboring block actions.
The final focused run passed 39 tests in six files. TypeScript passed and
Biome check passed for all ten directly affected module files, with no new
diagnostics. git diff --check passed.

The existing App file has ten lint warnings, with identical diagnostic
signatures on the base and this change. Its unrelated baseline formatting and
import ordering are preserved. Only the hook destructuring and Mermaid popup
action call sites change there.

All operations ran in the isolated M2 worktree from c74b2be under Sendery.
The broad candidate sweep was already green and was not repeated. No native
build, Cargo, producer, real UI, Actions, push, PR or publication ran here.
Root owns combined-candidate visual acceptance; logical tests do not claim it.
