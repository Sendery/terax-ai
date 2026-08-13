# Agent Monitor Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a zero-token, no-MCP, foldable Agent Monitor to Terax and ship validated vertical integrations in this order: Pi, Claude Code, Codex.

**Architecture:** Terax keeps the PTY as the trusted observation boundary. Harness-specific integrations emit only bounded lifecycle markers into their own PTY; Rust validates and emits typed Tauri events; a React/Zustand projection renders them in a foldable side panel. The monitor never invokes an LLM, opens a network connection, reads terminal text, or executes harness commands.

**Tech Stack:** Rust/Tauri, PTY OSC 777 events, React 19, TypeScript, Zustand, Vitest, Pi extension API.

---

## Acceptance criteria

- The monitor is a resizable, persisted, foldable panel and focuses the exact terminal pane on selection.
- Pi is the first native lifecycle adapter: TUI-only, `agent_start` becomes working, `agent_settled` becomes finished, and it emits no monitor activity outside Terax. Its existing `terax_visual_qa` capability must capture the visible monitor through the bounded native `agent-monitor` target (not OS desktop capture).
- Claude Code keeps its native hook path and surfaces `working`, `attention`, and `finished` without consuming tokens.
- Codex has an explicit vertical capability record and process/OSC lifecycle fallback. It does not falsely claim a native hook or permission state.
- The panel visibly distinguishes integration authority: `Native hook`, `Pi extension`, or `PTY detection`.
- Other harnesses are explicitly deferred in source documentation, not presented as supported.
- Monitoring has no MCP dependency or protocol, no AI SDK call, and no listener beyond Terax's existing Tauri event/PTY path.

## Vertical slices

1. Add pure monitor projection types/selectors and their red tests.
2. Add Agent Monitor panel visibility/width persistence and panel UI.
3. Extend Pi's first-party extension to publish OSC lifecycle markers and unit-test each callback.
4. Keep Claude's hook installer as the native integration and annotate its capability contract.
5. Add Codex capability/detection contract plus tests for real PTY OSC lifecycle behavior.
6. Run focused tests, frontend checks, Rust tests/checks, and a final diff review.

## Deferred harnesses

OpenCode, Cursor, Gemini CLI, Aider, Cline, Kilo, Qwen Code, Amp, Crush, Droid and other harnesses are future vertical integrations. Each must add its own capability record, official lifecycle source where available, installation/uninstallation contract, fixtures, and Linux/Windows/WSL validation before appearing as `validated` in the monitor.
