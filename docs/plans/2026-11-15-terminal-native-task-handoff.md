# Owner-bound scheduled task handoff

## Problem and behavior

Interactive task delivery previously resolved a terminal handle from its leaf
id again on each operation, used fire-and-forget writes, and recorded an ok run
even when handOffPrompt reported no readiness or no confirmed turn. A changed
owner, private flag, space, directory or agent could therefore receive stale
input or supply unrelated confirmation text. Busy markers retained in history
also turned an unrelated repaint into apparent success.

Task delivery now captures an internal TerminalInput and TaskTerminal context.
The context binds process identity, task directory, public tab, original split
leaf, space and agent occurrence. Focusing a sibling pane keeps the original
target. Closing, privatizing, moving or replacing it invalidates the capture.
Native and legacy input share owner checks; native raw writes propagate the
caller guard through requireNative and the input queue until pty_write.
Asynchronous buffer reads and negotiated Shift+Enter encoding are discarded if
their context changes. No new Pi/MCP command, IPC argument or dependency exists.

Starting a new agent uses the existing captured shell submitter and actual
shell readiness. The TUI handoff separately waits for negotiated input readiness.
Readiness timeout sends no prompt. Multiline text is encoded after negotiation,
written once and awaited, then Enter is sent separately with bounded retries.
The original pre-Enter buffer remains the baseline across retries, so activity
already visible before a retry does not require another Enter.

Visual turn evidence requires an increase in busy-marker rows. Spinner-frame,
timer or detail changes on an existing busy row do not count. Literal prompt
text, including common composer prefixes and soft-wrapped echoes, is excluded.
Null/rejected queries, stale contexts and unrelated output do not confirm a
turn. This remains a visual heuristic, not an acknowledgement from the agent
or proof of task completion. Ambiguous delivery is reported as failed.

## Delivery uncertainty and retries

A run is ok only when both readiness and visible turn evidence are present.
After prompt writing has been attempted, an unconfirmed result or rejection is
failed without automatic retry of the same uncertain prompt. Only Enter is
retried within one handoff; prompt text is never replayed there.

Agent launch also has an internal onWriteAttempt marker. It reaches the native
invoke boundary, or the immediate legacy PTY write, after final ownership
checks. A launch that may have written and then loses its acknowledgement is
not automatically repeated. A launch rejected before any write retains normal
failure-policy retry. After an acknowledged launch, readiness failure before a
prompt write retains normal retry behavior.

The dispatcher wakes pending sleeps on unmount, retires its lifetime token and
prevents late writes or run updates. Task deletion also invalidates delivery.

## Attempt counts and created conversations

Occurrence accounting and created-session metadata have separate callbacks.
Dispatch increments lastRunAt and runCount using the latest task mirror, without
claiming a session. An acknowledged launch records its session separately;
prewrite failure and uncertain launch do not fabricate a created UUID. Therefore
a prewrite retry uses --session-id, while a retry after a confirmed launch can
use --resume. Headless delivery records the session after spawn acknowledgement.

Reusing an agent records its actual known recoverable conversation id and keeps
that id in TaskRun, rather than replacing it with the task's unused seed.
PI/Claude bindings without a known safe id are not recorded as newly created.
Codex retains directory-based resume-last behavior. Session metadata does not
increment the occurrence counter a second time. The original conversation seed
is captured and checked against the latest task mirror before input and before
persisting the acknowledgement. Regenerating a conversation while terminal or
headless launch waits cannot reinsert the previous UUID or displace the new seed.
Already-scheduled backoff callbacks also compare their original seed before
starting recovery, so a regenerated conversation does not inherit a stale retry.

## Queue correctness

Admission reads a synchronously updated canonical queue, so two run calls in
one React batch cannot both bypass overlap=queue. A completed run releases only
its own run id, preserving a concurrently running sibling. Pending occurrences
remain queued until the effect starts one. The draining effect reads the
canonical queue and consumes the pending occurrence once.

These changes retain the existing queue depth, overlap policies, run statuses,
failure backoff and user notifications. Uncertain deliveries use the existing
failed status and a message explaining why automatic retry was skipped.

## Scope and verification

All work used the M2 isolated worktree:
  /Users/andres.rojo/Workspaces/terax-worktrees/native-task-handoff

Branch feat/native-terminal-task-handoff starts from ef3af8b. The protected
original Mac project was not read, edited or built. The lane ran no Cargo,
sandbox build, UI control, performance experiment, Actions, push, PR or merge.
App changes are limited to task adapter wiring and imports; formatting noise
outside that scope was removed only after saving a complete backup and proving
byte-identical Biome output for the minimal candidate.

Before implementation, eight behavior regressions failed for stale writes,
unawaited writes, noise confirmation and false successful dispatch. Additional
queue, parallel-release, timer/detail and prompt-prefix/wrap cases were observed
red before their fixes. Source review found the uncertain launch edge; explicit
write-attempt tracking and three retry-policy cases cover it. Four further
metadata cases were reproduced red before separating attempted dispatch from
confirmed session ownership.

Tests exercise private/CWD/space/leaf/owner changes while raw writes, reads and
key encoding are delayed; exact split targeting; agent occurrence/session
replacement; actual facade guards; native final-write markers; legacy PTY
markers; no prompt before readiness; unconfirmed-result classification;
prewrite retry versus uncertain-write no-retry; batched admission; effect-driven
queue drain; parallel sibling release; and unmount cancellation.

Checks:

    pnpm exec vitest run src/modules/tasks/lib src/modules/terminal/gl/engineSession.test.ts src/modules/terminal/gl/nativeLeafSession.test.ts src/modules/terminal/lib/sessionSubmission.test.ts src/modules/terminal/lib/sessionSubmissionFacade.test.ts src/modules/agents/lib/useAgentSessionRestore.test.ts
    pnpm check-types
    pnpm exec biome lint src/app/App.tsx src/modules/tasks/index.ts src/modules/tasks/lib/handoff.ts src/modules/tasks/lib/handoff.test.ts src/modules/tasks/lib/policies.ts src/modules/tasks/lib/deliveryState.ts src/modules/tasks/lib/deliveryState.test.ts src/modules/tasks/lib/useTaskDispatcher.ts src/modules/tasks/lib/useTaskDispatcher.test.ts src/modules/tasks/lib/taskTerminal.ts src/modules/tasks/lib/taskTerminal.test.ts src/modules/terminal/gl/engineSession.ts src/modules/terminal/gl/engineSession.test.ts src/modules/terminal/gl/nativeLeafRegistry.ts src/modules/terminal/gl/nativeLeafSession.ts src/modules/terminal/gl/nativeLeafSession.test.ts src/modules/terminal/index.ts src/modules/terminal/lib/useTerminalSession.ts src/modules/terminal/lib/terminalInput.ts src/modules/terminal/lib/sessionSubmission.ts src/modules/terminal/lib/sessionSubmission.test.ts src/modules/terminal/lib/sessionSubmissionFacade.test.ts
    git diff --check

The final focused command passes 419 tests in 23 files. Types and diff-check
pass. The 22-file lint subset has 13 existing warnings in older App/test code
and no new warning. Logs are under .terax/pi-development/m2/logs/handoff-*.

Source review and focused TS checks are evidence for the integration contract.
A real Claude/Pi/Codex scheduled handoff in the combined macOS sandbox remains
parent runtime acceptance. This report does not claim full terminal parity,
multi-platform runtime validation, or a production-default rollout.
