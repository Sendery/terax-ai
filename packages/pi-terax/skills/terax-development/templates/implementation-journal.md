# Pi Implementation Journal

Copy this file to `.terax/pi-development/<branch-or-run-name>/journal.md` when starting an isolated implementation. This journal is local evidence and is not committed. Never record credentials, tokens, private terminal content, or user secrets.

## Run Identity

- Request:
- Repository root:
- Base branch:
- Base commit:
- Feature branch:
- Worktree path:
- Target platforms:
- Started:

## Scope and Invariants

### Requested behavior

- 

### Explicit non-goals

- 

### Security and privacy boundaries

- 

### Completion evidence required

- 

## Change Matrix

Mark each row `affected`, `not applicable`, or `deferred`.

- Model:
- Mutation API:
- UI:
- Transformations:
- Persistence and hydration:
- Settings:
- Shortcuts:
- Semantic commands:
- Snapshots and redaction:
- Rust/Tauri bridge:
- Pi package:
- End-to-end harness:
- Visual QA:
- Accessibility:
- Documentation:

## TDD Log

For each vertical slice record the behavior, failing command and expected failure, minimal implementation, passing command, and any refactor.

### Slice 1

- Behavior:
- RED command:
- Expected failure observed:
- GREEN change:
- GREEN command and result:
- Refactor and regression result:

## Gotcha Candidates

Use one entry per unexpected constraint. Update the entry as the hypothesis becomes a confirmed cause.

### GOTCHA-CANDIDATE-001: Short trigger-oriented title

- Status: observed | reproduced | fixed | verified | discarded | promoted
- Scope: local | platform | subsystem | cross-cutting
- Confidence: low | medium | high
- Trigger:
- Symptom:
- Exact failing command or action:
- Root cause or hypothesis:
- Prevention or fix:
- Regression test or verification:
- Related existing catalog entry:
- Promotion decision and reason:

## Verification Evidence

### Focused tests

- Command:
- Result:

### Frontend gates

- Tests:
- Types:
- Build:
- Lint:

### Pi package gates

- Tests:
- Build:

### Rust gates

- Unit and integration tests:
- Clippy:
- Native build:

### Real integration

- Tested executable:
- Discovery and authentication:
- Successful command:
- Resulting snapshot:
- Reset:
- Invalid input:
- Missing target:
- No-mutation evidence:

### Visual QA

- Surface and exact identity:
- Interaction exercised:
- Evidence paths:
- Privacy guard:
- Visual verdict:

### Baseline failures

For each failure include proof that it exists on the base and the focused status of modified code.

- 

## Final Diff Review

- Every changed file accounted for:
- Independent review findings:
- Fixes applied after review:
- Final tests rerun:
- `git diff --check`:
- Main checkout status:

## Gotcha Triage

For every candidate choose exactly one outcome:

- Promote to `references/gotchas.md`.
- Merge into an existing catalog entry.
- Move a universal architecture invariant to `TERAX.md`.
- Defer with a concrete reason and required evidence.
- Discard as one-off environment noise.

Do not finish with unclassified candidates.

## Authorized Git Actions

- Commit authorized: yes | no
- Merge authorized: yes | no
- Push authorized: yes | no
- Worktree cleanup authorized: yes | no
- Actions actually performed:

## Final Summary

- Delivered behavior:
- Actual passing evidence:
- Remaining limitations:
- Durable gotchas improved:
