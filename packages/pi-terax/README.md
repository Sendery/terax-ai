# @crynta/pi-terax

First-party Pi Agent package for controlling a running Terax window and extending the Terax source tree through a project-aware development skill.

## Install locally

From the Terax repository:

```bash
pnpm --filter @crynta/pi-terax build
pi install ./packages/pi-terax
```

Restart Pi after installation.

## Host awareness

The extension detects whether Pi runs inside a Terax terminal via the `TERAX_TERMINAL=1` / `TERM_PROGRAM=Terax` environment Terax injects. Inside Terax it registers the full tool set; in any other terminal it registers only `terax_status` (minimal footprint) and posts a one-time startup notice with enable instructions. Set `TERAX_FORCE=1` to operate against a reachable Terax from a non-Terax shell.

## Tools

- `terax_status`: reports whether this session is inside a Terax terminal, which capabilities are available, and how to enable them when not.
- `terax_get_state`: returns a structural, redacted snapshot of tabs and sidebar state.
- `terax_call`: invokes an allowlisted Terax command with a validated payload.
- `terax_wait`: waits briefly before the next state check.
- `terax_development_guide`: returns exact contribution points, invariants, tests, and verification commands for features, windows, settings, shortcuts, and commands.
- `terax_visual_qa`: captures screenshots, records short per-window videos, and compares Terax against approved project baselines.

## Development skill

The package bundles `terax-development` and `terax-visual-qa`. Pi can load them automatically or invoke them explicitly:

```text
/skill:terax-development
/skill:terax-visual-qa
```

The development skill directs Pi to inspect `AGENTS.md` and `TERAX.md`, call `terax_development_guide`, create an isolated branch and worktree, implement vertical slices through strict test-first changes, exercise the real authenticated path, and run the project quality gates. It includes a cross-layer checklist for models, UI, persistence, commands, snapshots, Rust, the Pi package, accessibility, and visual QA.

Each run uses an ignored journal copied from `skills/terax-development/templates/implementation-journal.md`. Unexpected constraints are captured there as candidates, then reproduced, deduplicated, and either promoted to the bundled `references/gotchas.md`, moved to `TERAX.md` as architecture invariants, deferred with evidence requirements, or discarded. This keeps implementation knowledge durable without turning one-off failures into folklore.

The visual skill adds a state/action/screenshot-or-video/verdict loop for future features. Pi uses its built-in read, edit, write, and bash tools to change Terax source. Terax does not load arbitrary extension code at runtime.

`terax_call` supports:

- `app.snapshot`
- `app.commands` -- authoritative catalog of every command and payload argument
- `app.buildInfo`
- `app.capture` -- native in-app PNG capture of a Terax surface
- `sidebar.show`
- `sidebar.hide`
- `tab.openFile`
- `preview.open`
- `mermaid.open`
- `mermaid.update`
- `tab.focus`
- `tab.close`
- `tab.rename`
- `tab.resetTitle`
- `tab.setColor` -- assign or clear a tab accent color
- `git.diff.open`
- `settings.open`
- `notes.show`, `notes.hide`, `notes.toggle` -- the notes panel
- `notes.detach`, `notes.attach` -- float the notes panel or dock it back
- `notes.add`, `notes.remove`, `notes.update`, `notes.list` -- note cards on the active tab
- `tasks.show`, `tasks.hide`, `tasks.toggle` -- the scheduled tasks panel
- `tasks.openEditor` -- open the task editor for the user to review or complete
- `tasks.list`, `tasks.add`, `tasks.update`, `tasks.remove` -- manage scheduled tasks
- `tasks.run`, `tasks.setEnabled` -- run one now, or enable and disable it
- `tasks.pauseAll`, `tasks.resumeAll` -- the global scheduler pause
- `tasks.wake` -- re-evaluate the schedule and dispatch anything due

### mermaid.open

Open Mermaid source in an editable split view:

```json
{ "command": "mermaid.open", "payload": { "source": "flowchart LR\nA-->B", "title": "Build flow" } }
```

Source is limited to 48 KiB UTF-8 and is intentionally omitted from `app.snapshot`. Live preview is available through 24 KiB; larger sources remain editable and persistent while preview pauses to keep Terax responsive. The authenticated protocol allows 384 KiB frames to accommodate worst-case JSON escaping of a valid source.

### mermaid.update

Replace the source of an existing Mermaid tab using the `tabId` returned by
`mermaid.open` or reported by `app.snapshot`:

```json
{ "command": "mermaid.update", "payload": { "tabId": 13, "source": "flowchart LR\nA-->C", "title": "Build flow v2" } }
```

The source uses the same normalization and 48 KiB limit as `mermaid.open`.
Updates are rejected for missing or non-Mermaid tabs, stale visual layout is
cleared, the source is never returned, and the tab is not focused implicitly.

### app.capture

Capture any Terax surface natively: the webview rasterizes the requested surface to a PNG persisted in a private app-cache directory. No OS screen-capture API or permission is involved on any platform, and content outside the Terax window cannot appear in the image.

```json
{ "command": "app.capture", "payload": { "target": "pane", "tabId": 3 } }
```

Targets (closed set): `window`, `header`, `sidebar`, `tabstrip`, `statusbar`, `active-pane`, `pane` (requires `tabId`), `overlay` (topmost open menu, dialog, or popover), `agent-monitor` (the visible monitor panel only). Returns `{ target, path, width, height, bytes, format: "png" }`.

Rules and limits:

- Private terminals block capture with scope-correct errors: any private tab blocks `window`, `tabstrip`, and `agent-monitor`; the targeted private tab blocks `pane`; and an active private tab blocks the remaining targets. Rejected captures never mutate state.
- Hidden mounted DOM panes (editor, markdown, diff) capture fully. A hidden idle terminal has released its renderer slot and captures chrome only; call `tab.focus` first, capture, then focus back.
- Password inputs are masked. Arbitrary selectors are rejected.
- Prefer `terax_visual_qa` with `target`/`tabId` for QA evidence: it adds trusted-project gating, guard monitoring, and evidence management on top of this command.

### tab.setColor

Assign a palette color to a tab or clear an existing one:

```json
{ "command": "tab.setColor", "payload": { "tabId": 1, "color": "teal" } }
```

Palette (exact names): `red`, `orange`, `amber`, `green`, `teal`, `blue`, `indigo`, `purple`, `pink`.

Pass `null` for `color` to remove the accent. Any value outside the palette -- unknown names, hex strings, numbers -- is rejected with `invalid_payload`. The assigned color appears in `app.snapshot` for every non-private tab kind; private terminals are reported as `kind: "private-terminal"` and never expose a color.

## Security

The extension discovers Terax through a user-cache file created at app startup, including a Windows `LOCALAPPDATA` fallback when Pi runs in WSL. The bridge binds only to `127.0.0.1`, uses a per-launch random token, validates protocol version and command IDs, and caps request frames. Private terminal details and terminal text are excluded from snapshots. Visual QA is restricted to trusted projects, binds every frame to the authenticated PID and exact Terax window identity, and refuses or aborts capture if a private terminal appears. Main-surface evidence is produced by in-app rasterization (`app.capture`), which is OS-agnostic, needs no OS permissions, and structurally cannot include non-Terax content; the settings window uses the system backend. Capture limits are 7,680 x 4,320, 16,777,216 pixels, 30 seconds, 30 FPS, 900 frames, and 512 MiB of temporary frames.

This package does not implement an MCP server, client, transport, or protocol path. Any MCP SDK present transitively through the Pi host or existing workspace tooling is not used by this extension.

See `../../docs/pi-terax.md` for protocol details and `../../docs/pi-visual-qa.md` for the evaluation workflow.
