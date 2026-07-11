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
3. Stop if the active tab is a private terminal. The visual tool also enforces this boundary.
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

The native backend is implemented on Windows and WSL. It uses Win32 `PrintWindow` frames cropped to DWM extended-frame bounds, then encodes those private frames with Windows FFmpeg. Limits are 7,680 x 4,320, 16,777,216 pixels, 30 seconds, 30 FPS, 900 frames, and 512 MiB of temporary frames. The current backend smoke produced a 626 x 413 PNG and a three-second H.264 MP4 at 15 FPS; visual inspection found no desktop, cursor, unrelated windows, black bands, or corruption. A roughly one-pixel dark contour and resize grip were native window chrome. Other platforms must add their own `VisualBackend` implementation and real smoke evidence before being documented as supported.

## Completion Checklist

- [ ] Acceptance criteria were converted to observable checks
- [ ] Initial and final Terax state were inspected
- [ ] No active private terminal was captured
- [ ] Screenshot or video was visually inspected by Pi
- [ ] Baseline comparison was used only when appropriate
- [ ] Functional tests and type checks still pass
- [ ] Evidence paths and limitations are included in the verdict
