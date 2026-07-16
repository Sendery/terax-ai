---
name: terax-development
description: Use when Pi must add or modify a Terax feature, native window, setting, keyboard shortcut, semantic command, panel, tab type, persistence path, or other product capability. Requires isolated branch and worktree development, test-first vertical slices, cross-layer verification, private visual QA, and a durable system for capturing, promoting, and retiring implementation gotchas.
version: 2.0.0
author: Crynta
license: Apache-2.0
metadata:
  pi:
    tags: [terax, development, tdd, worktrees, visual-qa, gotchas]
---

# Terax Feature Development

## Overview

Extend Terax through reviewed source changes, tests, and compiled artifacts. Pi may create product capabilities, but it must not turn Terax into an arbitrary runtime plugin host. Use the official Pi extension API and Terax command bridge for controlled interaction. Do not add MCP, dynamic code loading, raw callback execution, or unreviewed remote code paths.

Treat every request as a vertical product change. A feature can cross domain types, React UI, persistence, semantic commands, the authenticated Rust bridge, the Pi package, documentation, native builds, and visual behavior. A change is complete only when every affected layer is implemented and verified.

## When to Use

Use this skill for:

- New or changed product behavior.
- Tabs, panes, panels, menus, dialogs, or native windows.
- Settings and persisted preferences.
- Keyboard shortcuts and command-palette actions.
- Semantic app commands exposed to Pi.
- State snapshots, serialization, hydration, or migrations.
- Cross-platform behavior requiring Rust or Tauri changes.

Do not use it merely to control a running Terax instance through existing commands. For that, use `terax_get_state`, `terax_call`, and `terax_wait`. Use `terax-visual-qa` whenever appearance or interaction changes.

## Non-Negotiable Rules

1. Work in an isolated branch and worktree unless the user explicitly declines isolation.
2. Read the repository instructions before planning or editing.
3. Write a failing behavior test before production code.
4. Keep domain logic pure and dependency-light. React and Tauri boundaries coordinate it.
5. Validate untrusted input at every boundary and use closed typed sets where possible.
6. Preserve secret, private-terminal, workspace-authorization, and approval boundaries.
7. Never claim completion from compilation alone. Exercise the real path and inspect the result.
8. Do not commit, merge, push, publish, or delete a worktree unless the user has authorized that action.
9. Record implementation gotchas as they occur. Promote only verified, reusable lessons.

## Phase 0a: Recognize the host and bootstrap the source

Orientation must not assume the session started in the Terax checkout.

1. Confirm which domain applies. Call `terax_development_guide` with `orientation` and `terax_status`. If the task is only controlling a running Terax, stop here and use the control tools; do not clone or build.
2. Only for the develop or extend-Pi domains, locate the source:
   - If the current directory is a Terax checkout, use it.
   - If not, read the running binary's provenance with `app.buildInfo` (repository and commit) and clone that exact source, then develop from an isolated worktree:
     ```bash
     git clone https://github.com/<repository>.git <dir>
     git -C <dir> checkout <commit>
     ```
   Perform the clone with your own bash under workspace authorization. The bridge never clones. Clone only when the task needs source changes.

## Phase 0b: Establish Scope and Invariants

1. Confirm the current directory belongs to Terax:

   ```bash
   git rev-parse --show-toplevel
   git status --short --branch
   ```

2. Read `AGENTS.md` and `TERAX.md`. Follow any nested instruction file covering a modified path.
3. Call `terax_development_guide` using the nearest capability: `feature`, `window`, `setting`, `shortcut`, or `command`.
4. Inspect existing implementation paths before naming new modules, stores, command IDs, window labels, or schemas.
5. Write a compact change map:
   - user-visible behavior;
   - affected data model;
   - persistence and migration impact;
   - native or OS boundary;
   - semantic command and Pi exposure;
   - security and privacy invariants;
   - accessibility behavior;
   - test and visual evidence required.

Completion criterion: every requested behavior maps to concrete existing contribution points or an explicitly justified new module.

## Branch and Worktree Protocol

### Choose the base deliberately

Do not assume the currently checked-out branch is the correct base. Identify the branch containing all prerequisite work, verify it is clean, and record its commit:

```bash
git status --short --branch
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
```

If prerequisite changes are uncommitted, stop and report that isolation cannot reproduce them from a commit. Do not silently copy a dirty tree.

### Create an isolated implementation lane

Use descriptive names and a sibling worktree directory:

```bash
base_branch="<verified-base-branch>"
feature_branch="feat/<short-capability-name>"
worktree="../terax-worktrees/<short-capability-name>"

git worktree add -b "$feature_branch" "$worktree" "$base_branch"
```

Never delete or reset an existing branch to make this command succeed. If the branch or path already exists, inspect it and either reuse it with user approval or choose a new name.

### Worktree discipline

- Run every read, edit, build, and test command from the worktree.
- Keep the main checkout unchanged.
- Record the absolute worktree path and branch in the implementation journal.
- Recheck `git status --short --branch` before and after each major phase.
- Generated evidence belongs under ignored project paths, never beside source files.
- Do not share one build target directory between simultaneous native builds.

### Integration discipline

Before asking to merge:

1. Rebase or merge the latest intended base only if the user approves history changes.
2. Run all gates from a cleanly identified worktree state.
3. Review the complete diff and account for every file.
4. Separate feature failures from baseline failures with reproducible evidence.
5. Commit only when authorized.
6. Merge with the requested strategy. Never infer that push is allowed from permission to commit or merge.

Completion criterion: the experiment is reproducible from the recorded base commit, and no unrelated checkout was modified.

## Phase 1: Test-First Vertical Slices

Implement one observable behavior at a time:

1. Add the smallest failing test.
2. Run it and confirm it fails for the missing behavior, not a typo or environment error.
3. Add minimal production code.
4. Run the focused test until green.
5. Run neighboring tests.
6. Refactor only while green.
7. Record newly discovered gotchas immediately.

Prefer slices that cross real boundaries early. For example, a remotely controllable UI capability should first prove one command can change one real state value through:

```text
Pi client -> authenticated TCP -> Rust/Tauri -> React registry -> domain mutation
```

Do not build all layers independently and postpone integration until the end.

## Phase 2: Architecture and Change Matrix

Read `references/contribution-points.md` for current paths. For any cross-cutting feature, complete the matrix in `references/gotchas.md` and mark each affected row as implemented, not applicable, or intentionally deferred.

### Domain and UI

- Put domain types, validation, transitions, and formatting in pure module functions.
- Keep `src/app/App.tsx` as a coordinator.
- Export module APIs through a thin `index.ts`.
- Avoid extra dependencies for behavior expressible with existing primitives.
- Preserve existing lifecycle rules, including tabs remaining mounted when inactive.

### Persistence

A new state field is not complete when it only exists in memory. Inspect:

- runtime type;
- default value;
- mutation API;
- serialization;
- hydration;
- legacy entries;
- corrupt or invalid stored values;
- transformations between related types;
- workspace or space restore.

Use public validators during hydration. Ignore invalid optional values safely instead of trusting casts. Add round-trip and invalid-stored-value regression tests.

### Windows and native surfaces

- Use stable Tauri labels.
- Reuse, show, and focus singleton windows before creating new ones.
- Validate query parameters and deep links.
- Register native commands and capabilities explicitly.
- Verify on the target OS when behavior depends on native windowing, paths, shells, or process lifetime.

### Settings

Implement schema, default, hydration, setter, synchronization, UI control, and tests together. Store secrets only through the keychain path. Define behavior for older stores lacking the field and for malformed values.

### Shortcuts

Add one semantic shortcut ID and route it through the central registry and App handler. Preserve Cmd on macOS and Ctrl on other platforms. Check terminal readline and editor bindings before selecting defaults. Avoid parallel global listeners for the same action.

### Semantic commands and Pi exposure

The frontend command registry is the product API. The command palette is presentation, not the external contract.

When exposing a command, update and test all applicable layers:

- typed command ID and payload validation;
- frontend registry handler;
- React/domain mutation;
- structured snapshot if state observation is required;
- Rust bridge allowlist;
- Pi package allowlist and schema;
- extension tests;
- end-to-end harness;
- user documentation.

Use closed typed values instead of arbitrary CSS, script, path, or callback payloads. Rejected commands must not mutate state. Test invalid values, missing targets, and state after rejection.

## Phase 3: Security, Privacy, and Accessibility

### Security and privacy

- Keep the bridge loopback-only, authenticated, framed, bounded, and timeout-controlled.
- Preserve workspace authorization for filesystem, shell, process, and git actions.
- Preserve secret-path guards on reads and writes.
- Do not expose terminal buffers, terminal text, private-terminal metadata, AI approval IDs, or diff contents through snapshots.
- Redact the full private object rather than hiding only one newly added field.
- Require approval for destructive or mutating AI actions.
- Never put tokens or credentials in tests, logs, journals, screenshots, or reports.

### Accessibility

Visual output alone is insufficient. For each interactive UI change verify:

- semantic control roles;
- keyboard reachability and operation;
- visible labels where meaning would otherwise rely on color;
- focus behavior for menus, dialogs, and windows;
- accessible selected state;
- dirty, error, or status announcements.

An explicit parent `aria-label` replaces descendant accessible content. If a parent label is introduced, it must include every descendant state users previously heard, such as an unsaved-change indicator. Put label construction in a pure helper and test combinations.

## Phase 4: Real Integration and Visual QA

### Semantic verification

Use the actual built package and authenticated bridge. Do not substitute mocks for the final proof. Assert:

1. initial snapshot;
2. successful command result;
3. resulting snapshot;
4. reset or inverse operation;
5. invalid payload rejection;
6. missing-target rejection;
7. no state mutation after each rejected command.

### Native visual verification

Use `terax_visual_qa` and the `terax-visual-qa` skill. Bind evidence to the authenticated Terax PID and exact window identity. Capture only Terax surfaces. Private terminals must block capture for the full recording, not only at startup.

Inspect at least:

- default and changed states;
- active and inactive states;
- context menus or dialogs;
- keyboard-selected state;
- narrow or crowded layout;
- contrast, clipping, overlap, and focus;
- reset behavior.

Compilation plus a screenshot is not enough. Exercise the interaction and verify the semantic snapshot matches the pixels.

### Native process lifecycle

A development app intentionally terminated during cleanup may exit with a signal-derived code such as `-15`, `143`, or the platform equivalent. Do not classify that code in isolation. Record whether compilation completed, the app became ready, the bridge responded, tests completed, and cleanup was deliberate. Conversely, a successful compile does not prove the bridge or UI worked.

## Phase 5: Quality Gates and Review

Run focused checks first, then the repository gates:

```bash
pnpm test
pnpm check-types
pnpm build
pnpm lint
pnpm --dir packages/pi-terax test
pnpm --dir packages/pi-terax build
cd src-tauri
cargo clippy
cargo test --locked
```

Also run `git diff --check` and inspect the complete diff. Use the exact commands from `TERAX.md` when they differ.

If the full repository has baseline failures:

1. Capture the exact failure.
2. Run the same gate on the base commit or otherwise prove the baseline.
3. Run the gate on changed files or focused suites.
4. Fix every newly introduced diagnostic.
5. Report baseline failures separately. Never call the global gate green.

Request an independent final review for cross-layer changes. Resolve all blocking findings, rerun affected gates, and re-review the final diff.

Completion criterion: actual outputs support every completion claim, all introduced failures are fixed, and remaining baseline or platform limitations are named precisely.

## Gotcha Learning System

Use a two-tier system: a private implementation journal for candidates and a reviewed catalog for durable lessons.

### Tier 1: implementation journal

At the start of each isolated change, copy `templates/implementation-journal.md` to:

```text
.terax/pi-development/<branch-or-run-name>/journal.md
```

The `.terax/pi-development/` path is ignored by Git. Keep temporary paths, process IDs, screenshots, raw failures, and uncertain observations here. Never store secrets.

For every unexpected failure or non-obvious constraint, record:

- symptom and exact command;
- trigger and affected platform;
- confirmed root cause or current hypothesis;
- workaround or fix;
- verification evidence;
- candidate scope;
- confidence and status.

Update the same entry as understanding improves. Do not append contradictory folklore.

### Tier 2: durable catalog

Promote a candidate to `references/gotchas.md` only when it is:

- reproduced or supported by a regression test or reliable tool output;
- likely to recur across more than one implementation;
- free of secrets, temporary IDs, machine-only paths, and stale branch details;
- expressed as trigger, failure mode, prevention, and verification.

Architecture facts that every contributor needs belong in `TERAX.md`. Workflow lessons for Pi belong in this skill or its catalog. One-off run evidence stays in the journal.

### Improve, do not only accumulate

At the end of each implementation:

1. Review every candidate.
2. Promote, merge into an existing entry, defer with reason, or discard.
3. Replace stale wording instead of stacking a second rule.
4. Add a regression test when the gotcha represents a code invariant.
5. Mark superseded catalog entries and remove them once no supported version needs them.
6. Keep the catalog organized by trigger, not chronology.

Completion criterion: no unresolved candidate is silently lost, and the durable catalog becomes shorter or more precise when lessons overlap.

## Common Failure Patterns

1. **Wrong base branch:** the worktree lacks prerequisite bridge changes. Verify and record the base commit before creation.
2. **Control without extension:** adding only a Pi command does not create product behavior. Implement the domain and UI first.
3. **In-memory-only state:** a field works until workspace restore. Audit every persistence and transformation path.
4. **One allowlist missed:** frontend tests pass but the real bridge rejects the command. Use the full command exposure checklist.
5. **Arbitrary style payloads:** accepting raw CSS expands the attack and compatibility surface. Use a typed palette.
6. **Private snapshot leakage:** redacting terminal text but exposing new metadata still leaks. Redact the complete private entry.
7. **Accessible content overwritten:** a parent label hides dirty or status descendants. Compose and test the full label.
8. **Mock-only confidence:** mocked clients do not prove native discovery, authentication, or React delivery. Run the real chain.
9. **Screenshot-only confidence:** pixels do not prove state, and state does not prove pixels. Verify both.
10. **Cleanup code mistaken for failure:** classify process exit with lifecycle evidence, not the numeric code alone.
11. **Baseline lint used as an excuse:** prove baseline status and remove all new diagnostics.
12. **Gotcha sediment:** repeated notes drift into conflicting rules. Merge, rewrite, test, and retire.

## Final Verification Checklist

- [ ] Correct base commit, feature branch, and worktree recorded
- [ ] Main checkout remained unchanged
- [ ] `AGENTS.md`, `TERAX.md`, and relevant contribution points read
- [ ] Every behavior began with an observed failing test
- [ ] Domain, UI, persistence, transformations, and invalid data audited
- [ ] Every external command layer and allowlist updated together
- [ ] Rejected commands proven not to mutate state
- [ ] Private terminals, secrets, authorization, and approvals preserved
- [ ] Keyboard and screen-reader behavior verified
- [ ] Real authenticated integration exercised
- [ ] Native visual evidence inspected when UI changed
- [ ] Focused and full gates run with actual outputs recorded
- [ ] Complete diff reviewed with no unrelated changes
- [ ] Gotcha candidates triaged and durable lessons improved
- [ ] Commit, merge, push, publish, and cleanup performed only as authorized
