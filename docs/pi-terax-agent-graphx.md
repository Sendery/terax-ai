# Pi-Terax Agente and persistent GraphX diagrams

Select **Pi-Terax Agente** in the built-in AI agent picker (also listed in Settings > Agents).
It uses the existing configured model/provider, so connect a model first if the AI composer
is not configured. Its role is to organize tabs, classify content, manage notes and build
interactive system diagrams. It discovers the current command catalog instead of assuming
a particular bridge version.

Try: "Organize these tabs by task", "Classify these tabs with colors", "Show this system as
an interactive graph", or "Dock this graph beside my terminal".

## Discover and customize manager actions

With an SDK-backed model in the built-in AI, the actual tools are `terax_app_state`, `terax_app_command` and
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

The selected persona and custom instructions also reach the existing Claude Code,
Codex, Cursor Agent and OpenCode CLI runners as a separate instruction section before
the conversation transcript. Pi receives them once in its system-prompt append.
The stored user/assistant messages are unchanged. Selecting a CLI provider does not
attach Terax's SDK tools: use that CLI's configured MCP connection, or Pi's Terax
extension, and report missing capabilities. `terax_manager_actions` is SDK-only;
CLI agents read the configuration through their own authorized file tools.

Pi agents use their offered `terax_status`, `terax_get_state` and
`terax_call` tools. MCP clients discover the offered grouped tools, including
`terax_inspect` and `terax_open_view`. External agents can read the same configuration
with their authorized file tools. The in-app tool names are not external MCP tool names.

## Graph tabs and panels

Choose **New GraphX diagram** from the new-tab menu or command palette. The starter diagram
includes a playable sequence. Use **Raw** or **Side by side** to edit or import JSON, then **Apply JSON**.
**Rendered** shows the graph alone. The preview follows the unsaved draft; switching
views retains it, and only Apply commits a new revision.

The Raw editor includes **Format JSON** (two spaces, one Undo) and live JSON syntax
diagnostics with line/column, alongside GraphX schema validation. Formatting preserves
number spellings, duplicate keys and selection, and only changes the draft. The same
tools are available for `.graphx` files; Save remains separate from formatting.
See [renderable views](renderable-views.md#format-and-validate-graphx-json) for limits.
Invalid input leaves the last saved graph intact. **Reload current** recovers after an
agent changed the graph while you were editing. **Copy JSON** exports the saved source to
the clipboard.

The graph is a persistent space tab. Its source, identity, revision, title/color, notes,
panel position and panel size survive normal space/app restoration. It can be reordered,
renamed and colored like other tabs. Closing it removes it from the space, as with other
tabs; copy its JSON first when you want a separate file. A renamed tab label is stored
separately from the graph source title and survives later graph updates. Resetting
the label restores the source title. Older saved labels that differ from the
source title are migrated as custom names; restored custom names are bounded to
80 characters. If an older flattened label equals the source title, no separate
rename can be inferred.

The placement selector offers **Tab**, **Dock left**, **Dock right** and **Float**.
A side dock reserves workspace width beside an existing public terminal in the same space.
Docking, floating and moving keep the current public terminal selected. From the full graph
tab, they return to the last public terminal used in that space, falling back to another
public terminal only when that choice is no longer available. This focus memory lasts for
the current app session and never records a private terminal.
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
needed. The upstream bundle, with literal trailing whitespace escaped without changing its values, is in `public/graphx/engine.js`, with its SHA-256,
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
actual frame and a fresh session token. Replies report bounded render geometry or PNG pixels for an owned capture request;
they cannot invoke app commands, access files or write terminal input.

Packaged macOS WebKit does not match CSP `self` for scripts inside this opaque
sandbox under `tauri://localhost`. Both the app CSP response header and the frame
meta policy therefore allow exactly `tauri://localhost/graphx/engine.js` and
`tauri://localhost/graphx/frame.js`. Keep both policies aligned; a scheme-wide
allowance or `allow-same-origin` is unnecessary.

Tauri also adds real nonces to static style elements and its response CSP. A nonce
makes `unsafe-inline` ineffective for later dynamic styles. The trusted frame
adapter reads the nonce from its marked static base style and applies it only to
the pinned engine stylesheet and styles synchronously created by the validated
GraphX mount. It then reprocesses their text, preserving generated node/edge
colors. There is no general style observer, invented nonce, CSP relaxation or
change to the upstream engine. In HTTP development, where Tauri adds no nonce,
the adapter preserves the existing stylesheet behavior.

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

M2 Chromium acceptance passed on 2026-11-16. The isolated implementation pass did
not control a running Terax app. Root subsequently completed the coordinated
packaged application acceptance recorded below. Rust changes are limited to the bridge allowlist and
its decode test; native checks/build were reserved for the root.

A macOS system WebKit check also covers the packaged custom-scheme CSP behavior:

```sh
mkdir -p .terax/pi-development/graphx-webkit-runtime
swiftc scripts/check-graphx-webkit.swift -o .terax/pi-development/graphx-webkit-runtime/check-graphx-webkit
.terax/pi-development/graphx-webkit-runtime/check-graphx-webkit
```

Run from the repository root. It reads the real app CSP and bundled frame assets,
serves them through an owned `WKURLSchemeHandler`, models Tauri's static-style
nonce injection and response-policy transformation, and uses a nonpersistent,
unshown WebKit view without activating any app. It checks two fresh-token frame
lifetimes and revisions, layout/shapes, changed dimensions, stale source/token
rejection in the fixture, and blocked parent access, network, inline and unlisted
scripts. Its diagnostic user script selects the engine's supported reduced-motion
branch because an unshown WK view does not service animation frames. The diagnostic
also finishes only fixture CSS transitions before sampling pixels; otherwise an
unshown view can retain the initial black color interpolation. No production
script, frame privileges or Tauri APIs are injected. `--baseline` removes the two
exact CSP sources from both policies and must fail with script CSP violations.

This isolated WebKit check passed on M2 on 2026-11-16; the baseline reproduced
the packaged blank-frame failure. It does not replace visible packaged-app
acceptance, which remains part of the coordinated integration pass.


## Capturing a visible graph

Use the existing `app.capture` command for the window or the visible graph pane.
The capture adapter snapshots the actual GraphX DOM/SVG, including its current
graph/flow view and controls. It composites the opaque frame PNG and the parent
panel toolbar above native terminal pixels, preserving foreground menus. It does
not switch tabs, focus controls, resize a terminal or start a subprocess.

A capture request is bound to the actual frame, fresh frame token, document
incarnation, revision and one-use request id. Snapshot preparation shares the
existing capture deadline and privacy guard through persistence. Unmount, hiding,
source replacement, resize or cancellation invalidates its lease; late responses
cannot revive it. The trusted adapter has one bounded snapshot operation, with no
evaluation endpoint. PNG payloads are limited to 12 MiB of base64 text; dimensions
use the existing capture limits (7680 by 4320 maximum, 16,777,216 total pixels).
DOM/style/markup limits also bound serialization work. A graph that is still
loading, hidden, unavailable or over these limits produces an explicit capture
error, never a successful blank substitute. Open a hidden graph before capturing
its pane. Existing private-terminal capture refusals still apply.

The parent status announces a render receipt containing the saved revision and
actual SVG node/path counts and dimensions only after computed engine styles
and visible SVG geometry are valid. The receipt follows the visible graph or
flow SVG. Default unstyled 300-by-150 SVGs cannot claim successful readiness. Individual node labels need not
appear as separate accessibility objects: the GraphX SVG has an image role.
The receipt confirms geometry, while PNG inspection confirms visible content.

On macOS, run `node scripts/check-graphx-capture.mjs` from the repository root
with existing project dependencies and Swift SDK. It bundles only the rasterizer
test fixture, then runs an owned, unshown system WKWebView. The fixture checks
real GraphX PNGs and the actual compositor for both window and pane captures,
with synthetic native canvas pixels, parent toolbar and overlapping menu.
The packaged-policy fixture verifies responsive SVG sizing, system fonts,
styled controls, generated color fills, graph and initial-flow views, plus
continued rejection of unauthorized inline styles. Run its compiled binary with
`--baseline-styles` to remove the adapter's static nonce marker; this must fail
with an explicit styles error. It saves PNG evidence under ignored
`.terax/pi-development/graphx-webkit-runtime/`. No Terax process is started or
controlled. The frame and composition checks passed on M2; visible packaged-app
capture acceptance is recorded in the coordinated integration section below.


## Resizing an embedded graph

The graph stage fills the panel height remaining below its toolbar and above its
optional tour. Toolbar and tour keep their natural height. Terax's static embed
CSS overrides the engine's narrow-screen stage height (58vh), so resizing or
docking a panel uses its available space without replacing the frame or document.

Run the compiled `scripts/check-graphx-webkit.swift` fixture with `--panel-fit`
to check a live resize of the same iframe, token and revision from 640×440 to
680×700. It verifies SVG width/height growth, unclipped tour content and alignment
with the bottom of the panel under the packaged nonce policy.


## Coordinated M2 application acceptance

The integrated packaged application passed graph/sequence rendering, real panel
movement/resizing/docking, keyboard placement, terminal focus/session retention,
restart/geometry restoration, manager tab/note commands, Pi/MCP reads and updates,
stale-write rejection and private/hidden capture refusal. The last code candidate
is 2d869a3. See [the acceptance report](plans/2026-11-16-pi-terax-graphx-acceptance.md)
for artifact identity, evidence and limitations. No model/provider turn was sent.
