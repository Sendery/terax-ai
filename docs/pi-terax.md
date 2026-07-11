# Pi Terax MVP

Pi Terax lets a Pi coding-agent package control a running Terax window through a first-party command registry and extend the Terax source tree through a bundled development skill. It is not MCP and does not expose an MCP server.

## Command Registry

The frontend registry lives in `src/modules/commands`. It is separate from the command palette UI and accepts typed command requests:

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

The registry validates command IDs and payloads before dispatch, normalizes failures into `{ ok: false, error }`, and delegates behavior to existing App, tabs, sidebar, git diff, and settings APIs. It does not expose AI diff approval internals.

`app.snapshot` is intentionally redacted. It omits terminal text entirely, hides private terminal cwd and title details, and excludes AI diff approval IDs and proposed or original content.

## External Bridge

Rust owns the external listener in `src-tauri/src/modules/pi.rs`.

- Bind address: `127.0.0.1` only
- Transport: raw TCP with newline-delimited JSON
- Protocol version: `1`
- Port: ephemeral per app launch
- Auth: per-launch random token
- Discovery file: user cache directory, `terax-ai/pi-bridge.json`
- Frame cap: 64 KiB
- Request timeout: 5 seconds for frame IO, 15 seconds for UI response

Rust validates protocol version, token, frame size, and command allowlist, then emits a Tauri event to the React bridge. React executes the frontend registry command and replies through the `external_command_respond` Tauri command.

The discovery file is written atomically. Terax removes stale discovery data on startup when practical and removes its own file on normal state drop.

## Pi Package

The package is in `packages/pi-terax` and is named `@crynta/pi-terax`. It declares the Pi host packages as peer dependencies and bundles one extension entry plus the `terax-development` skill. The extension registers four tools:

- `terax_get_state`: returns the redacted Terax snapshot.
- `terax_call`: calls only allowlisted Terax registry commands.
- `terax_wait`: waits for a short interval before the next state check.
- `terax_development_guide`: returns project contribution points for a feature, native window, setting, shortcut, or app command.

The client uses Node built-ins only for its TCP transport and adds no direct HTTP or MCP transport dependency.

Install after publishing or from a local checkout:

```bash
pi install npm:@crynta/pi-terax
```

For local development, build the package first:

```bash
pnpm --filter @crynta/pi-terax build
```

Then point Pi at the package using Pi's local package workflow or by copying the built package into a Pi package source.

## Extending Terax with Pi

The bundled `terax-development` skill is the supported source-extension workflow. When Pi is asked to add a feature, window, setting, shortcut, or command, it:

1. Reads `AGENTS.md` and `TERAX.md`.
2. Calls `terax_development_guide` for current contribution points.
3. Inspects the existing implementation before editing.
4. Adds failing tests before production code.
5. Uses its built-in filesystem and shell tools to change the Terax repository.
6. Runs the frontend and Rust quality gates.

This deliberately extends Terax at source level. The app does not dynamically load arbitrary JavaScript or Rust plugins from Pi. New functionality is reviewed, tested, and compiled with Terax before it ships.

## Security

The bridge is local only. It requires both the ephemeral port and the per-launch token from the discovery file. Any client without the token receives an authorization failure. The Pi extension also enforces the same command allowlist before sending a request.

Snapshots are a privacy boundary. They are for UI coordination, not content extraction. Terminal buffers, terminal text, private terminal metadata, and AI diff approval internals are not included.

## Non-goal

MCP is explicitly out of scope for this MVP. Do not add direct MCP dependencies, MCP server code, or MCP protocol paths to this integration. Transitive packages supplied by the Pi host or existing workspace tooling are not part of the Terax bridge.
