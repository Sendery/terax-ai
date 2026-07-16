# Pi Terax MVP

Pi Terax lets a Pi coding-agent package control a running Terax window through a first-party command registry and extend the Terax source tree through a bundled development skill. It is not MCP and does not expose an MCP server.

## Development domains

Pick the right domain before acting. The orientation is discoverable at runtime (call `terax_status` and `terax_development_guide` with `orientation`), so it does not depend on the Pi session starting inside the Terax checkout.

| Goal | Skill | Extension / tools | Technology | Where the code lives |
|---|---|---|---|---|
| a) Control a running Terax | (none) | `terax_get_state`, `terax_call`, `terax_wait`, `app.commands` | tools only, no build | does not touch code |
| b) Develop a Terax feature | `terax-development` | `terax_development_guide`, `terax_visual_qa` | React 19 + TypeScript, Rust/Tauri | `src/`, `src-tauri/` |
| c) Extend the Pi bridge (new command/tool) | `terax-development` | same, plus editing the package | TypeScript + typebox + Node TCP, and the Terax registry + Rust allowlist | `packages/pi-terax/`, `src/modules/commands`, `src-tauri/src/modules/pi.rs` |

### Host awareness

Terax injects `TERAX_TERMINAL=1` and `TERM_PROGRAM=Terax` into every terminal it spawns. The extension detects this at activation:

- Inside a Terax terminal: the full tool set is registered.
- In any other terminal: only `terax_status` is registered (minimal footprint, no context loaded), and a one-time startup notice explains that Pi-Terax is unavailable and how to enable it (open Terax, run Pi from a Terax terminal). Set `TERAX_FORCE=1` to opt in against a reachable Terax from another shell.

### Bootstrap for development

The develop and extend-Pi domains work from any cwd. `app.buildInfo` reports the running binary's `repository`, `branch`, `commit`, and `channel`, so when no local checkout is present Pi can clone that exact source and create an isolated worktree, only when the task requires source changes. The bridge itself never clones; Pi performs it with its own bash under workspace authorization.

## Command Registry

The frontend registry lives in `src/modules/commands`. It is separate from the command palette UI and accepts typed command requests:

- `app.snapshot`
- `app.commands`
- `app.buildInfo`
- `app.capture`
- `sidebar.show`
- `sidebar.hide`
- `tab.openFile`
- `tab.focus`
- `tab.close`
- `tab.rename`
- `tab.resetTitle`
- `tab.setColor`
- `git.diff.open`
- `settings.open`

The registry validates command IDs and payloads before dispatch, normalizes failures into `{ ok: false, error }`, and delegates behavior to existing App, tabs, sidebar, git diff, and settings APIs. It does not expose AI diff approval internals.

`app.snapshot` is intentionally redacted. It omits terminal text entirely, hides private terminal cwd and title details, and excludes AI diff approval IDs and proposed or original content.

### app.capture

Rasterize a Terax surface inside the webview and persist it as a PNG in a private app-cache directory. No OS screen-capture API or permission is involved, and the capture cannot include content outside the Terax window. Targets are a closed set: `window`, `header`, `sidebar`, `tabstrip`, `statusbar`, `active-pane`, `pane` (requires `tabId`, works for hidden but mounted tabs), and `overlay` (topmost open menu, dialog, or popover). Capture is refused when a private terminal is in scope.

```json
{ "id": "app.capture", "payload": { "target": "pane", "tabId": 3 } }
```

Returns `{ target, path, width, height, bytes, format: "png" }`.

### app.buildInfo

Read the running app's source provenance so a client can develop against the exact source:

```json
{ "id": "app.buildInfo" }
```

Returns `{ repository, branch, commit, channel }`. It exposes only public About-page provenance, no secrets.

### app.commands

Read the supported arguments for every command. This is the discovery action: call it before `terax_call` to learn each command's payload shape without guessing.

```json
{ "id": "app.commands" }
```

Returns `{ version: 1, commands: [{ id, description, params }] }`. Each `param` reports `name`, `type` (`string` | `integer` | `boolean` | `enum`), `required`, `description`, and, for enums, the closed `values` set (for example the `tab.setColor` color palette) plus `nullable` when `null` is also accepted. The catalog is derived from the same schema table the registry validates against, so documented arguments never drift from enforced ones.

### tab.setColor

Assign or clear a palette color accent on any tab.

```json
{ "id": "tab.setColor", "payload": { "tabId": 1, "color": "teal" } }
```

- `tabId` (number, required): the ID of the tab to update, as reported by `app.snapshot`.
- `color` (string | null, required): one of the nine palette names, or `null` to clear the color.

Palette: `red`, `orange`, `amber`, `green`, `teal`, `blue`, `indigo`, `purple`, `pink`.

Any value outside this exact set -- including unknown color names, arbitrary hex strings, or non-string types -- is rejected with `invalid_payload`. Pass `null` to remove an assigned color. The color is reflected immediately in `app.snapshot` for every non-private tab kind; private terminals appear as `kind: "private-terminal"` in the snapshot and never expose a color field.

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

The package is in `packages/pi-terax` and is named `@crynta/pi-terax`. It declares the Pi host packages as peer dependencies and bundles one extension entry plus development and visual-QA skills. The extension registers five tools:

- `terax_get_state`: returns the redacted Terax snapshot.
- `terax_call`: calls only allowlisted Terax registry commands.
- `terax_wait`: waits for a short interval before the next state check.
- `terax_development_guide`: returns project contribution points for a feature, native window, setting, shortcut, or app command.
- `terax_visual_qa`: returns screenshot evidence, records short MP4s, or compares the UI against a project baseline.

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
3. Verifies the prerequisite base commit and creates an isolated branch and worktree.
4. Starts an ignored implementation journal from the bundled template.
5. Inspects the existing implementation and completes the cross-layer change matrix.
6. Adds failing tests before production code and builds one vertical slice at a time.
7. Exercises the real authenticated path and native visual behavior when applicable.
8. Runs the frontend, Pi package, Rust, diff, and changed-file quality gates.
9. Triages each gotcha candidate into the durable catalog, `TERAX.md`, a justified deferral, or discard.

This deliberately extends Terax at source level. The app does not dynamically load arbitrary JavaScript or Rust plugins from Pi. New functionality is reviewed, tested, and compiled with Terax before it ships.

The bundled `terax-visual-qa` skill defines how Pi validates those changes with semantic state plus native visual evidence. See `pi-visual-qa.md` for the tool contract, Windows/WSL backend, privacy rules, and baseline policy.

## Security

The bridge is local only. It requires both the ephemeral port and the per-launch token from the discovery file. Any client without the token receives an authorization failure. The Pi extension also enforces the same command allowlist before sending a request.

Snapshots are a privacy boundary. They are for UI coordination, not content extraction. Terminal buffers, terminal text, private terminal metadata, and AI diff approval internals are not included.

## Non-goal

MCP is explicitly out of scope for this MVP. Do not add direct MCP dependencies, MCP server code, or MCP protocol paths to this integration. Transitive packages supplied by the Pi host or existing workspace tooling are not part of the Terax bridge.
