# Pi Visual QA

Pi Visual QA combines Terax command/state checks with native visual evidence. It is intended for future feature development, regression checks, and review evidence.

## What it validates

A complete evaluation has three independent layers:

1. **Functional:** unit/integration tests and successful typed commands.
2. **Structural:** `terax_get_state` before and after the interaction.
3. **Visual:** screenshot, short video, and optional SSIM baseline comparison.

A feature passes only when all applicable layers pass. SSIM alone cannot prove correct behavior, and a visually correct screenshot cannot prove that the command or persisted state is correct.

## Pi tool

`terax_visual_qa` accepts:

- `action`: `screenshot`, `video`, or `compare`.
- `surface`: `main` or `settings`.
- `target` (main surface only): native in-app capture target, one of `window` (default), `header`, `sidebar`, `tabstrip`, `statusbar`, `active-pane`, `pane`, `overlay`. `overlay` captures the topmost open menu, dialog, or popover.
- `tabId`: tab id, required with `target: pane`; also reaches panes that are mounted but hidden. Hidden DOM panes (editor, markdown, diff) render fully. A hidden idle terminal has released its renderer slot, so its pane captures chrome only; focus the tab (`tab.focus`), capture, then restore focus.
- `name`: evidence name; path separators are rejected.
- `durationSeconds`: video duration from 1 to 30 seconds.
- `fps`: video rate from 1 to 30 FPS.
- `baselinePath`: project-contained baseline for `compare`. The file is capped at 64 MiB, opened without following a final symlink, identity-checked, and copied to a private per-run snapshot before FFmpeg reads it.
- `threshold`: SSIM threshold from 0 to 1, default `0.99`.

The tool requires Pi's current project to be trusted. Every surface authenticates the discovery record by requesting `app.snapshot` before and after capture; the main window additionally monitors the redacted snapshot throughout recording and refuses an active private terminal. A private terminal or guard failure aborts the operation and deletes the complete evidence directory, so no partial image or evidence is returned. Requests are fully validated before discovery, bridge calls, subprocesses, or filesystem writes. `captureSucceeded` only means evidence was produced; it is not a feature verdict. `baselinePassed` is present only for SSIM comparison and still requires visual inspection.

## Evidence layout

Every run uses a new unpredictable, exclusive directory with private permissions:

```text
.terax/visual-qa/20260711T123456Z-sidebar-toggle-XXXXXX/
├── screenshot.png       # screenshot or current comparison image
├── recording.mp4        # video action
├── preview.png          # post-video still returned to Pi
└── result.json          # machine-readable paths, window, capture status, score
```

Temporary video frames are deleted after FFmpeg encoding. The complete run directory is deleted on any error or abort, and `result.json` is published with a temporary-file rename. Frames are captured with Win32 `PrintWindow`, not full-desktop recording, so unrelated windows, desktop content, and the system cursor are excluded.

## Recommended feature scenario

```text
Given: expected feature state and a fixture workspace without secrets
1. terax_get_state
2. terax_visual_qa screenshot name=<feature>-before
3. terax_call <feature command>
4. terax_wait only if asynchronous UI stabilization is required
5. terax_get_state and assert semantic change
6. terax_visual_qa screenshot or video name=<feature>-after
7. Pi inspects returned PNG content
8. Optional compare against an approved baseline
9. Record PASS, FAIL, or BLOCKED with evidence paths
```

When a future feature cannot be exercised through the registry, add a typed command or shortcut as part of that feature. Do not automate raw Tauri commands or arbitrary callbacks.

## Baselines

Store approved baselines under a project directory such as:

```text
visual-baselines/
├── main-default.png
└── settings-models.png
```

A baseline must already exist as a regular file whose canonical path remains inside the canonical trusted project. File symlinks and escaping directory symlinks are rejected. A baseline change requires visual review. Never overwrite the baseline automatically after a failed comparison. Different content, font rendering, DPI, themes, and operating-system chrome can lower SSIM even when behavior is correct; use separate baselines when those dimensions are intentional.

## Native in-app backend (main surface)

The `main` surface is captured by Terax itself, not by the operating system:

- The webview rasterizes the requested surface (DOM -> SVG foreignObject -> canvas -> PNG) through the `app.capture` registry command. No OS screen-capture API, permission, or authorization prompt is involved, and content outside the Terax window cannot appear in the evidence.
- Targets are a closed set; arbitrary selectors are rejected at the registry boundary.
- Private terminals block capture natively: any private tab blocks `window`/`tabstrip`, the targeted private tab blocks `pane`, and an active private tab blocks the remaining targets. The bridge-side `app.snapshot` guard still runs before, during, and after capture.
- xterm webgl surfaces render with `preserveDrawingBuffer`, and canvas pixels are composited directly onto the output (WebKit rasterizes foreignObject before nested data-URL images load). Password inputs are masked.
- Verified on macOS with real captures: full window at 2x DPI including live terminal split pixels, isolated targets, a hidden mounted markdown pane, an open context submenu, and all six private-terminal refusals with no state mutation.
- Rust persists the PNG under a private app cache directory (`visual-captures/`, owner-only permissions, 64 MiB cap, pruned by age and total size); the Pi backend copies it into the evidence directory and deletes the source.
- Video is a sequence of native frames encoded with local FFmpeg; SSIM comparison also uses FFmpeg. Screenshots need no external tools.

The `settings` window runs in a separate webview without the command bridge, so it continues to use the system backend below.

## Windows and WSL backend

The implemented backend:

- Enumerates visible top-level windows with Win32 and requires the exact authenticated discovery PID.
- Requires the exact `terax` process name and exact `Terax` or `Settings` title.
- Revalidates HWND ownership, PID, process name, and title immediately before every `PrintWindow` call.
- Crops the private `PrintWindow` bitmap to DWM extended frame bounds to remove invisible resize borders without capturing the desktop.
- Captures video as private per-window PNG frames.
- Encodes H.264 MP4 with Windows FFmpeg.
- Uses FFmpeg's SSIM filter for baseline scoring.
- Passes parameters through encoded PowerShell and environment variables; it does not interpolate a shell command.

Requirements:

- Windows PowerShell 5 or newer.
- FFmpeg available in the Windows `PATH`.
- When Pi runs in WSL, Windows interop and `wslpath` must be available.

## Resource limits

- Window width: at most 7,680 pixels.
- Window height: at most 4,320 pixels.
- Captured area: at most 16,777,216 pixels.
- Video: at most 30 seconds, 30 FPS, and 900 frames.
- Temporary frame data: at most 512 MiB per run.
- Child-process stdout and stderr combined: at most 1 MiB.
- Visual child-process timeout: 45 seconds per command by default; frame collection derives its timeout from the requested video duration plus bounded overhead, capped at 90 seconds.
- WSL discovery child-process timeout: 5 seconds, with at most 64 KiB output.

Video aborts if the DWM capture dimensions change. Abort signals and timeouts propagate through backend setup, PowerShell, `wslpath`, and FFmpeg. Commands use argument arrays with no shell.

## Current backend smoke result

The current PID-bound backend, including DWM extended-frame cropping and per-frame identity checks, was exercised against a real visible Windows test window:

- PNG: 626 × 413, readable and non-black.
- MP4: H.264, encoded at 626 × 414 for even YUV420 dimensions, 15 FPS, 45 frames, 3 seconds.
- Screenshot and extracted central video frame contained only the target window, without desktop, cursor, or unrelated windows.
- Visual inspection found no black bands or letterboxing. A roughly one-pixel dark left/bottom contour and the resize grip are native window chrome rather than captured desktop.
- Repeat-capture SSIM: `1.0`.

This smoke verifies the current backend mechanics against a controlled Windows window. A Terax feature evaluation must still be run against an actual Terax window and its feature-specific acceptance criteria.

## Privacy boundary

The tool prevents arbitrary desktop/window capture and blocks active private terminals, but a normal terminal, editor, preview, or settings field can still show sensitive information. Visual scenarios must use fixture data and a sanitized workspace. The returned image is intentionally provided to Pi for visual reasoning, so anything visibly rendered in the captured Terax window becomes model input.
