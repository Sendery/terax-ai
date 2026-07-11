# @crynta/pi-terax

First-party Pi Agent package for controlling a running Terax window and extending the Terax source tree through a project-aware development skill.

## Install locally

From the Terax repository:

```bash
pnpm --filter @crynta/pi-terax build
pi install ./packages/pi-terax
```

Restart Pi after installation.

## Tools

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
- `sidebar.show`
- `sidebar.hide`
- `tab.openFile`
- `tab.focus`
- `tab.close`
- `tab.rename`
- `tab.resetTitle`
- `tab.setColor` -- assign or clear a tab accent color
- `git.diff.open`
- `settings.open`

### tab.setColor

Assign a palette color to a tab or clear an existing one:

```json
{ "command": "tab.setColor", "payload": { "tabId": 1, "color": "teal" } }
```

Palette (exact names): `red`, `orange`, `amber`, `green`, `teal`, `blue`, `indigo`, `purple`, `pink`.

Pass `null` for `color` to remove the accent. Any value outside the palette -- unknown names, hex strings, numbers -- is rejected with `invalid_payload`. The assigned color appears in `app.snapshot` for every non-private tab kind; private terminals are reported as `kind: "private-terminal"` and never expose a color.

## Security

The extension discovers Terax through a user-cache file created at app startup, including a Windows `LOCALAPPDATA` fallback when Pi runs in WSL. The bridge binds only to `127.0.0.1`, uses a per-launch random token, validates protocol version and command IDs, and caps request frames. Private terminal details and terminal text are excluded from snapshots. Visual QA is restricted to trusted projects, binds every frame to the authenticated PID and exact Terax window identity, and refuses or aborts capture if a private terminal appears. Capture limits are 7,680 x 4,320, 16,777,216 pixels, 30 seconds, 30 FPS, 900 frames, and 512 MiB of temporary frames.

This package does not implement an MCP server, client, transport, or protocol path. Any MCP SDK present transitively through the Pi host or existing workspace tooling is not used by this extension.

See `../../docs/pi-terax.md` for protocol details and `../../docs/pi-visual-qa.md` for the evaluation workflow.
