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

## Development skill

The package bundles the `terax-development` skill. Pi can load it automatically when asked to add a Terax capability, or it can be invoked explicitly:

```text
/skill:terax-development
```

The skill directs Pi to inspect `AGENTS.md` and `TERAX.md`, call `terax_development_guide`, implement through test-first changes, and run the project quality gates. Pi uses its built-in read, edit, write, and bash tools to change Terax source. Terax does not load arbitrary extension code at runtime.

`terax_call` supports:

- `app.snapshot`
- `sidebar.show`
- `sidebar.hide`
- `tab.openFile`
- `tab.focus`
- `tab.close`
- `tab.rename`
- `tab.resetTitle`
- `git.diff.open`
- `settings.open`

## Security

The extension discovers Terax through a user-cache file created at app startup. The bridge binds only to `127.0.0.1`, uses a per-launch random token, validates protocol version and command IDs, and caps request and response frames. Private terminal details and terminal text are excluded from snapshots.

This package does not implement an MCP server, client, transport, or protocol path. Any MCP SDK present transitively through the Pi host or existing workspace tooling is not used by this extension.

See `../../docs/pi-terax.md` for protocol and architecture details.
