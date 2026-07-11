# Pi Visual QA Implementation Plan

> **For Hermes:** Use test-driven development task-by-task.

**Goal:** Give Pi a repeatable way to visually validate Terax features, capture screenshots, record short videos, and compare the current UI with approved baselines.

**Architecture:** Add a `terax_visual_qa` Pi tool backed by a small, tested capture library. The first native backend targets Windows and WSL, where Terax is currently developed, using PowerShell Win32 window discovery and `PrintWindow` for PNG and private per-window video frames, then Windows FFmpeg for MP4 encoding. The tool only targets windows owned by the Terax process, writes evidence under the trusted project, returns screenshots to Pi as image content, and supports baseline SSIM comparison. A bundled skill defines the before/action/after/report evaluation loop.

**Tech Stack:** Pi extension API, TypeBox, Node child processes, PowerShell Win32 APIs, FFmpeg, Vitest.

---

### Task 1: Define paths and visual QA requests

**Files:**
- Create: `packages/pi-terax/src/visual.ts`
- Create: `packages/pi-terax/test/visual.test.ts`

**Steps:**
1. Write failing tests for safe artifact names, project-contained output paths, surface selection, and Windows/WSL command planning.
2. Run the targeted test and confirm failure because the module does not exist.
3. Implement pure request validation and planning functions.
4. Run the targeted test and confirm it passes.

### Task 2: Implement screenshot, video, and comparison backends

**Files:**
- Modify: `packages/pi-terax/src/visual.ts`
- Modify: `packages/pi-terax/test/visual.test.ts`

**Steps:**
1. Write failing tests using injected process and filesystem operations.
2. Implement Terax-owned window discovery, PNG capture, MP4 recording, preview capture, and FFmpeg SSIM parsing.
3. Ensure subprocesses use argument arrays and environment variables, not interpolated shells.
4. Verify targeted tests.

### Task 3: Register the Pi visual QA tool

**Files:**
- Modify: `packages/pi-terax/src/extension.ts`
- Modify: `packages/pi-terax/test/extension.test.ts`
- Modify: `packages/pi-terax/src/index.ts`

**Steps:**
1. Write a failing extension test expecting `terax_visual_qa`.
2. Register `screenshot`, `video`, and `compare` actions.
3. Require a trusted Pi project context before any capture or file write.
4. Return PNG evidence as Pi image content and artifact metadata as details.
5. Verify extension tests and package type checks.

### Task 4: Bundle the evaluation workflow

**Files:**
- Create: `packages/pi-terax/skills/terax-visual-qa/SKILL.md`
- Create: `docs/pi-visual-qa.md`
- Modify: `packages/pi-terax/README.md`
- Modify: `docs/pi-terax.md`
- Modify: `TERAX.md`

**Steps:**
1. Document the before/action/after/state/visual/report loop.
2. Define baseline acceptance and update rules.
3. Document privacy boundaries and Windows/WSL requirements.
4. Add future backend extension points without claiming unsupported platforms.

### Task 5: Real smoke verification

**Steps:**
1. Run package types, tests, and build.
2. Launch a temporary visible Windows test window.
3. Exercise the same backend used by Pi to capture a PNG and a short MP4.
4. Verify file signatures, dimensions, duration, and non-empty frames with FFprobe.
5. Remove only the temporary test window; retain timestamped evidence.
6. Run root types/tests and an independent code review.
