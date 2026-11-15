# Owner-bound agent restoration

## Problem and resulting behavior

Agent restoration previously waited for a leaf readiness notification, then
called a fire-and-forget submit helper. The readiness promise also resolved on
timeout. Between matching a saved conversation and sending it, the pane could
close, change directory or space, become private, or replace its process under
the same leaf id. The hook marked recovery settled immediately, before native
submission completed, so session capture could overwrite the recovery snapshot.

Restoration now captures a submitter bound to the original process owner and
waits for actual readiness. Timeout, a busy/alternate-screen terminal, a missing
process or an invalid owner never confirms a submission. Native ownership uses
the controller identity, including opening before a PTY id exists. Legacy
ownership uses an internal token renewed at respawn; respawn also clears stale
readiness. View and renderer moves retain the same native process identity.

The hook revalidates public status, space, tab, leaf and directory before sending
and throughout the async native input path. A guard travels through the facade,
NativeLeafSession and EngineSession until immediately before pty_write. It is
checked after requireNative and native paste encoding; dismissing restoration or
changing privacy/CWD/space while encoding is pending cannot write stale input.
An empty submission's carriage return uses the same guarded path.

Each captured submitter attempts one delivery, and a recovery run ignores
duplicate restore calls. Rejections are contained and leave failed conversations
available in the existing recovery dialog. Capture remains gated while recovery
submissions are pending and while the old snapshot is being deleted. A late
snapshot read after dismissal cannot reopen the dialog or automatically resume
an agent. Run tickets and active lifetime checks handle dismissal, unmount and
effect setup/cleanup replay.

## Scope and boundaries

This uses existing saved-session validation, de-duplication, size limits and
resume command generation. It does not replay transcript contents. The new
submission identity and facade API are internal readonly ownership data, with
no Pi/MCP command, IPC shape, snapshot exposure, OS clipboard access or new
dependency. The existing legacy submit helper remains available to its other
callers.

Files are limited to agent restoration, the internal submission helper/facade,
native submission guard propagation, their tests and this report. Session
capture/store source is unchanged. Shared TERAX.md, parity inventory and gotcha
catalog updates are deferred to the parent integration to avoid parallel
documentation conflicts.

## Evidence

All reads, edits and checks used the M2 isolated worktree:
  /Users/andres.rojo/Workspaces/terax-worktrees/native-agent-restore

Branch feat/native-terminal-agent-restore starts at db918d0. The original
protected Mac project was not read, changed or built. No native Cargo command,
UI control, performance experiment, GitHub Action, push, pull request or merge
was run by this lane.

Before production changes, eight hook behavior tests failed for stale targets,
premature settled state, duplicate attempts, dismissal and lost failed sessions.
The first harness attempt needed a partial React mock; that environment failure
was corrected before recording the eight behavioral failures.

Astra source review identified a late boot-read ticket gap and a guard lost
during native encoding. Both were reproduced red: two boot-policy cases and six
native guard cases. An additional cleanup-order race was reproduced red before
fixing it. Directed source review of all three corrections reported no remaining
concrete blocker.

The final focused set contains 146 passing tests, including real facade calls
with a replacement native registry owner, opening id=null, timeout and legacy
respawn retaining the same Session object and leaf id. Existing native view
migration, input ordering and negotiated paste tests remain green.

Commands:

    pnpm exec vitest run src/modules/agents/lib/restore.test.ts src/modules/agents/lib/useAgentSessionRestore.test.ts src/modules/terminal/lib/sessionSubmission.test.ts src/modules/terminal/lib/sessionSubmissionFacade.test.ts src/modules/terminal/gl/nativeLeafSession.test.ts src/modules/terminal/gl/nativeLeafRegistry.test.ts src/modules/terminal/gl/engineSession.test.ts
    pnpm check-types
    pnpm exec biome lint src/modules/agents/lib/useAgentSessionRestore.ts src/modules/agents/lib/useAgentSessionRestore.test.ts src/modules/terminal/lib/sessionSubmission.ts src/modules/terminal/lib/sessionSubmission.test.ts src/modules/terminal/lib/sessionSubmissionFacade.test.ts src/modules/terminal/lib/useTerminalSession.ts src/modules/terminal/gl/nativeLeafRegistry.ts src/modules/terminal/gl/nativeLeafSession.ts src/modules/terminal/gl/nativeLeafSession.test.ts src/modules/terminal/gl/engineSession.ts src/modules/terminal/gl/engineSession.test.ts src/modules/terminal/index.ts
    git diff --check

Types and focused lint pass; the lint subset retains three existing non-null
assertion warnings in older tests, with no new warning. Logs and the development
journal are under .terax/pi-development.

## Remaining acceptance

This lane verifies source behavior and async boundaries. It does not establish
a real Claude/Pi/Codex resume inside the macOS sandbox, multi-platform runtime
acceptance, full migration parity or a production-default rollout. Parent
integration owns the combined build and real M2 scenario, serialized with other
native work. The active objective remains complete terminal replacement with
the same capabilities or better; 60 FPS remains optional.
