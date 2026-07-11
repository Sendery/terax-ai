---
name: terax-development
description: Use when the user asks Pi to add or modify a Terax feature, native window, setting, keyboard shortcut, command, panel, tab type, or other product capability.
---

# Terax Development

## Overview

Extend Terax by changing its source code and tests. Use the first-party development guide tool to find the current contribution points, then inspect the repository before editing. Do not introduce a runtime plugin loader, MCP, or arbitrary remote code execution.

## Required Workflow

1. Confirm the current directory belongs to the Terax repository and read `AGENTS.md` plus `TERAX.md`. Stop if either file identifies a different project.
2. Call `terax_development_guide` with the closest capability: `feature`, `window`, `setting`, `shortcut`, or `command`.
3. Inspect every path listed in the guide that is relevant to the requested change. Do not guess at stores, handlers, window labels, or command IDs.
4. Write one focused failing test for the first behavior and run it. Confirm the failure is caused by missing behavior.
5. Implement the minimum code needed to pass. Keep React components and Tauri commands thin; put changed logic in pure functions.
6. Repeat the test-first cycle for each additional behavior.
7. Run the guide's verification commands. If an environment dependency blocks a command, report the exact missing dependency and run all unaffected checks.
8. Summarize changed paths, actual test output, and any remaining platform verification.

## Capability Rules

### Features

Create self-contained modules under `src/modules/<area>/` with a thin `index.ts`. Keep `src/app/App.tsx` as coordinator only. OS access belongs under `src-tauri/src/modules/` and must pass through a registered Tauri command.

### Windows

Use a stable Tauri window label. Reuse, show, and focus an existing window before creating another. Add a dedicated HTML and frontend entry only when the surface is genuinely independent. Validate all query and deep-link parameters.

### Settings

Persist non-secret preferences through the existing settings store. Add the type, default, hydration, setter, event synchronization, and UI control as one change. API keys and credentials stay in the keychain.

### Shortcuts

Add the ID and metadata to the shortcut registry, then wire the semantic handler through App. Preserve macOS versus Ctrl-platform behavior and avoid overriding terminal readline bindings unintentionally.

### Commands

Add typed payload validation and tests before wiring the handler. Expose a command through the Pi bridge only when remote execution is intended, and update every allowlist together. Never expose raw callbacks, raw Tauri commands, or AI approval internals.

## Security Boundaries

- Preserve the workspace authorization registry for filesystem, git, shell, and process actions.
- Preserve read and write secret-path guards.
- Require user approval for destructive or mutating AI tools.
- Do not put secrets in settings, logs, snapshots, terminal metadata, or discovery files beyond the existing ephemeral bridge token.
- Do not add MCP to this integration.

## Reference

Read `references/contribution-points.md` when a change spans more than one capability or when adding a new tab or window surface.

## Verification Checklist

- [ ] `AGENTS.md` and `TERAX.md` were read
- [ ] `terax_development_guide` was called
- [ ] Every behavior was introduced by a failing test
- [ ] No unrelated refactor was included
- [ ] Private terminal and secret boundaries remain intact
- [ ] Frontend types and tests pass
- [ ] Rust checks pass or an exact environment blocker is reported
- [ ] No MCP dependency or code was added
