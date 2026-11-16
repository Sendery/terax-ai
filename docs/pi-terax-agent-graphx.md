# Pi-Terax Agente and persistent GraphX diagrams

Select **Pi-Terax Agente** in the built-in AI agent picker (also listed in Settings > Agents).
It uses the existing configured model/provider, so connect a model first if the AI composer
is not configured. Its role is to organize tabs, classify content, manage notes and build
interactive system diagrams. It discovers the current command catalog instead of assuming
a particular bridge version.

Try: "Organize these tabs by task", "Classify these tabs with colors", "Show this system as
an interactive graph", or "Dock this graph beside my terminal".

## Discover and customize manager actions

In-app, the actual tools are `terax_app_state`, `terax_app_command` and
`terax_manager_actions`. The last tool reads the active workspace's
`.terax/pi-terax-commands.json` and returns validated custom actions plus starter actions.
It never executes the file. The normal command tool performs each selected action and
preserves normal validation and approval policy.

Copy [the starter configuration](examples/pi-terax-commands.json) into
`.terax/pi-terax-commands.json` under your workspace, or ask the agent to create it through
the ordinary approved file-writing tool. Edit labels, commands and payloads to personalize
ordering, classification, labelling, notes and graph placement. The file has version 1,
at most 24 actions, at most 8 steps per action and at most 24 KiB.

`$tabId`, `$graphId`, `$title` and `$color` are explicitly resolved by the agent from
your request and a fresh snapshot. They are not evaluated as code. Commands are restricted
to the UI allowlist in `src/modules/ai/lib/piTeraxManager.ts`; arbitrary shell commands,
scripts, extra instruction fields and duplicate action ids are rejected. When the file is
missing or invalid, the tool returns starter actions and the reason.

External Pi agents use their offered `terax_status`, `terax_get_state` and
`terax_call` tools. MCP clients discover the offered grouped tools, including
`terax_inspect` and `terax_open_view`. External agents can read the same configuration
with their authorized file tools. The in-app tool names are not external MCP tool names.

## Graph tabs and panels

Choose **New GraphX diagram** from the new-tab menu or command palette. The starter diagram
includes a playable sequence. Use **JSON** to edit or import a JSON file, then **Apply JSON**.
Invalid input leaves the last saved graph intact. **Reload current** recovers after an
agent changed the graph while you were editing. **Copy JSON** exports the saved source to
the clipboard.

The graph is a persistent space tab. Its source, identity, revision, title/color, notes,
panel position and panel size survive normal space/app restoration. It can be reordered,
renamed and colored like other tabs. Closing it removes it from the space, as with other
tabs; copy its JSON first when you want a separate file.

The placement selector offers **Tab**, **Dock left**, **Dock right** and **Float**.
A side dock reserves workspace width beside an existing public terminal in the same space.
The terminal keeps its real session and stays interactive. A floating panel lives within
the workspace, rather than creating an OS window. Drag **Move** to reposition it; releasing
near the left or right workspace edge docks it. The resize corner supports pointer drag
and arrow keys. The placement selector provides keyboard docking.

One graph companion panel is shown per space. Placing another companion returns the
previous one to its normal tab. Opening an editor or another nonterminal tab hides the
companion; returning to a terminal shows it again. If the space has no public terminal,
the graph remains visible in its full tab until a suitable terminal exists.
The canvas is mounted only while visible. A new revision/theme replaces its isolated frame,
which retires all engine timers and transient pan/search/sequence state. Saved graph data
and panel placement remain intact.

## Control contract

Call `app.commands` first for the running version's exact schemas.

| Command | Required input | Result |
| --- | --- | --- |
| `graphx.open` | `source` JSON text; optional stable `graphId` | Creates a graph or focuses the existing id without replacing its data; returns tabId, graphId, documentId, revision, placement and created |
| `graphx.read` | `graphId` | Explicit source read with documentId, revision and placement |
| `graphx.update` | `graphId`, `documentId`, `expectedRevision`, `source` | Replaces only the same document incarnation at the expected revision; returns the next revision |
| `graphx.place` | `graphId`, `placement` | tab, left, right or floating; preserves document identity |

For Pi, use `terax_call` with these command ids. For MCP, use `terax_open_view` actions
`open_graphx`, `update_graphx`, `place_graphx`; explicit reads use
`terax_inspect` action `read_graphx`. The built-in manager uses
`terax_app_command` with the same command ids.

Use a descriptive key such as `service-map`. Keys start with a letter and contain up to
64 letters, digits, underscores or hyphens. Reuse the returned graphId. Before every write,
read its documentId and current revision. A stale revision or a closed/recreated document
fails without mutation; re-read and reconcile instead of blindly retrying. The snapshot
contains identity/revision/placement and source length, never the graph source.

Example source:

```json
{
  "title": "Service map",
  "lang": "en",
  "nodes": [
    {"id": "web", "label": "Web", "kind": "ui", "summary": "User interface"},
    {"id": "api", "label": "API", "kind": "service", "shape": "rounded"},
    {"id": "db", "label": "Database", "shape": "datastore"}
  ],
  "edges": [
    {"id": "request", "from": "web", "to": "api", "label": "Request", "animated": true},
    {"id": "write", "from": "api", "to": "db", "label": "Store"}
  ]
}
```

Ordinary updates start no process, watcher or polling loop. An agent already running in
Pi/MCP can call the update command directly. For explicitly requested scheduled updates,
use Terax's existing task lifecycle and a prompt that reads and updates the stable graph;
do not create an unowned graph subprocess. Graph JSON never executes commands.

## Supported GraphX subset and boundaries

The bundled engine is Sendery/graphx 1.7.0, pinned to
`919e2408f62d04241b12df7920cf23746da6424b`. It includes offline ELK; no CDN or server is
needed. The upstream bundle, with trailing whitespace normalized, is in `public/graphx/engine.js`, with its SHA-256,
copyright/provenance and the actual ELK license in that directory. Upstream has no LICENSE
file; this integration follows the owner's request and does not invent an upstream license.

The validated subset supports nodes/edges, nested parents, lanes, levels, collapsed nodes,
hex colors, deltas, the pinned engine's 54 named shapes, bounded table/class rows, spans,
metrics/notes, edge heads/tails, sequences and sequence blocks, plain-text tours, direction
and bounded layout options. Use `tour.steps[].body` for plain text. The canonical schema is
`src/modules/graphx/lib/document.ts`.

Limits: 48 KiB UTF-8 per graph, 160 nodes, 500 edges, 16 hierarchy levels, 12 flows with
160 messages each, 40 tour steps and 24 open graph tabs. Duplicate ids, missing endpoints,
invalid parent cycles and unsupported fields fail before mutation. Node/edge ids use the
same bounded identifier syntax as graph keys.

Deliberately excluded: `details_html`, `body_html`, arbitrary icons/CSS/theme objects,
external links/images/files, code execution, and direct Mermaid import. The existing
Mermaid tab remains available. Only validated data enters a sandboxed opaque-origin frame.
Its own CSP blocks network connections, inline scripts, forms and objects; it has no
same-origin, popup or top-navigation allowance. Parent/child messages are bound to the
actual frame and a fresh session token. Messages only acknowledge render state; they cannot
invoke app commands, access files or write terminal input.

## Verification and acceptance

Focused tests cover schema rejection, parent/endpoint validation, snapshot redaction,
space persistence, dock layout, stable ids under batched React updates, document
incarnations and stale revisions, manager configuration and registry/Pi/MCP parity.

Run a real isolated browser smoke check without downloading tooling:

```sh
CHROME_BIN=/path/to/existing/headless_chromium python3 scripts/check-graphx-frame.py
```

It uses an owned ephemeral loopback server, temporary browser profile and the bundled
assets. It verifies completed layout, shapes, sequence selection, two document frame
lifetimes, changed dimensions, blocked parent access/network/inline script and absence of
Tauri globals. It closes only its own browser/server and saves evidence under ignored
`.terax/pi-development/graphx-frame-smoke/`.

M2 Chromium acceptance passed on 2026-11-16. Packaged Tauri/WebKit acceptance, real pointer
drag/docking, restart/space restore in the running app and end-to-end authenticated Pi/MCP
invocation remain for the root's coordinated integration pass. No running Terax app was
changed by this implementation pass. Rust changes are limited to the bridge allowlist and
its decode test; native checks/build were reserved for the root.
