---
name: terax-visual-qa
description: Use when validating a Terax feature visually, collecting screenshots or short videos, comparing a UI against an approved baseline, or producing evidence that a new capability works correctly.
---

# Terax Visual QA

## Overview

Validate behavior and pixels together. Use the authenticated Terax tools for state and actions, then use `terax_visual_qa` for screenshot, video, and baseline evidence. A visual pass never replaces functional tests, type checks, or command-result validation.

## Required Evaluation Loop

1. Read the feature acceptance criteria and turn them into observable state, interaction, and visual checks.
2. Call `terax_get_state` and record the initial structural state.
3. Stop if the active tab is a private terminal. The visual tool and the in-app capture command both enforce this boundary natively.
4. Capture a `before` screenshot when layout change matters.
5. Execute the feature through `terax_call`, a user-facing shortcut, or Pi's normal development tools.
6. Call `terax_wait` only for the shortest required stabilization interval.
7. Call `terax_get_state` again and verify semantic state before judging pixels.
8. Capture an `after` screenshot or a 3-10 second video.
9. Inspect the returned PNG image content. Check the requested behavior, clipping, overlap, contrast, loading/error states, stale content, and unintended private data.
10. For stable surfaces, run `compare` against an approved project baseline. Treat SSIM as a regression signal, not proof of correctness.
11. Write the verdict with actual artifact paths, state observations, SSIM score when used, and any untested platform behavior.

## Tool Actions

### Screenshot

Use for final states, dialogs, menus, settings, and layout changes:

```json
{
  "action": "screenshot",
  "surface": "main",
  "name": "sidebar-after-toggle"
}
```

### Native surface targets (main surface)

The main surface is captured by Terax itself through the `app.capture` registry command: the webview rasterizes the requested surface, so no OS screen-capture API or permission is involved on any platform, and content outside the Terax window cannot appear in evidence. Add `target` to isolate a surface:

```json
{
  "action": "screenshot",
  "surface": "main",
  "target": "pane",
  "tabId": 3,
  "name": "terminal-pane-after-command"
}
```

- Targets: `window` (default), `header`, `sidebar`, `tabstrip`, `statusbar`, `active-pane`, `pane` (requires `tabId`), `overlay`, `agent-monitor` (only the visible monitor panel).
- `overlay` captures the topmost open menu, dialog, or popover; with a submenu open it captures the submenu. It fails when nothing is open.
- `agent-monitor` is the preferred evidence target for the foldable monitor: use it only after opening the monitor and never as a substitute for whole-window capture.
- `pane` reaches hidden mounted tabs: DOM surfaces (editor, markdown, diff) render fully. A hidden idle terminal has released its renderer slot, so its pane shows chrome only; call `tab.focus` on it, capture, then focus back.
- Private terminals block capture natively with scope-correct rules: any private tab blocks `window` and `tabstrip`; the targeted private tab blocks `pane`; an active private tab blocks the remaining targets. Rejected captures do not mutate state.
- `target` is only valid with `surface: "main"`. The settings window has no command bridge and stays on the system backend.

### Mermaid editor

Place the editor in a deterministic state through the authenticated command, wait for the debounced render, verify the redacted snapshot, then capture the pane by returned `tabId`:

```json
{ "command": "mermaid.open", "payload": { "source": "flowchart LR\nA-->B", "title": "Visual QA" } }
```

Check the CodeMirror source, split handle, up-to-date status, rendered diagram, zoom controls, and absence of clipping. Also exercise invalid syntax and recovery; while invalid, the UI may retain the last valid preview but must label it as stale. `app.snapshot` must never expose diagram source.

### Video

Use for animations, focus behavior, drag/resize, multi-step transitions, and regressions that only appear over time:

```json
{
  "action": "video",
  "surface": "main",
  "name": "settings-open-flow",
  "durationSeconds": 5,
  "fps": 15
}
```

The tool returns an MP4 path and a PNG preview. Inspect the preview immediately and sample the MP4 when motion details matter.

### Baseline comparison

Use only with a baseline already reviewed and stored inside the trusted project:

```json
{
  "action": "compare",
  "surface": "settings",
  "name": "settings-baseline-check",
  "baselinePath": "visual-baselines/settings.png",
  "threshold": 0.99
}
```

Do not update a baseline merely because comparison failed. Inspect the current screenshot, explain the intended change, and request or record explicit baseline approval.

## Verdict Format

```text
Visual QA: PASS | FAIL | BLOCKED
Feature: <name>
Functional state: <observed state and command result>
Visual checks: <what was inspected>
Regression score: <SSIM or not applicable>
Evidence: <PNG, MP4, result.json paths>
Limitations: <platform or untested interaction>
```

## Privacy and Safety

- Evidence is written to a private, exclusive directory under `.terax/visual-qa/` in the trusted project and the whole directory is deleted on failure or abort.
- Window discovery and every frame are bound to the authenticated Terax PID, exact process name, exact title, and revalidated HWND.
- An active private terminal blocks main-window capture before, during, and after capture.
- Normal terminals and editors may still contain visible sensitive text. Prepare fixture data and a non-secret workspace before capture.
- Never use visual evidence as a reason to expose credentials, API keys, personal chats, or unrelated windows.
- Do not capture arbitrary window titles or the full desktop.

## Current Platform Support

- **Main surface (all platforms):** the in-app rasterization backend is OS-agnostic and verified on macOS with real captures (full window at 2x DPI including live terminal split pixels, isolated targets, hidden mounted panes, and an open context menu). Screenshots need no external tools; video and SSIM comparison use local FFmpeg.
- **Settings surface:** captured by the system backend, implemented on Windows and WSL with Win32 `PrintWindow` frames cropped to DWM extended-frame bounds and encoded with Windows FFmpeg. Other platforms must add their own `VisualBackend` implementation and real smoke evidence before being documented as supported.
- Shared limits: 7,680 x 4,320, 16,777,216 pixels, 30 seconds, 30 FPS, 900 frames, and 512 MiB of temporary frames.

## Completion Checklist

- [ ] Acceptance criteria were converted to observable checks
- [ ] Initial and final Terax state were inspected
- [ ] No active private terminal was captured
- [ ] Screenshot or video was visually inspected by Pi
- [ ] Baseline comparison was used only when appropriate
- [ ] Functional tests and type checks still pass
- [ ] Evidence paths and limitations are included in the verdict
