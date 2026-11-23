# Mermaid diagrams

Terax uses GraphX to preview Mermaid fences in Markdown, Mermaid source files
(`.mmd` and `.mermaid`) and diagrams opened with `mermaid.open`. The command
continues to accept Mermaid and returns the same tab handle. It uses the same
preview as the other entry points, and the source remains editable Mermaid.
Supported diagrams use the same GraphX PNG frame capture as GraphX documents
when a user exports a workspace capture. The fallback draws a static SVG
image and travels through the ordinary DOM capture path.

## Conversion fidelity

The bundled converter is exercised with these fixtures in
`src/modules/graphx/lib/mermaid.test.ts`. These cover representative Mermaid
syntax and the resulting GraphX structure. Advanced syntax and styling can
differ, and GraphX reports skipped statements.

| Mermaid type | Verified conversion coverage |
| --- | --- |
| Flowchart, graph, flowchart-elk | Nodes, shapes, subgraphs, edge labels and styles. Click links are discarded. |
| Sequence | Participants, messages, notes, nested blocks and activations. |
| Class | Class members, relationships and cardinalities. Member HTML is discarded. |
| State | Start and end, composite states, choice and notes. |
| ER | Entity fields, keys and crow's-foot connectors. |
| Gantt | Date axis, tasks, dependencies, status and milestones. |
| Mind map | Nested nodes. |
| Timeline | Periods and events. |
| User journey | Scored steps and actors. |
| Git graph | Branch lanes, commits and merges. |
| C4 | People, systems, boundaries and relationships. |
| Architecture | Groups, services and connections. |
| Block | Grid placement and edges. |
| Requirement | Requirement status, elements and relationships. |
| Sankey | Weighted links. |
| Kanban | Columns and cards. |
| Treemap | Parent groups and weighted leaves. |
| Pie, XY, quadrant, radar, packet, Venn, ZenUML, other types | Sent directly to the Mermaid fallback. |

If GraphX declines a source or cannot lay it out, the same preview falls
back to Mermaid with an explanation. Terax keeps the lazy Mermaid runtime
for that fallback and for validating edits from the existing flowchart and
sequence visual editors. There is no separate viewer to choose.

Terax has a first-class Mermaid tab with **Raw**, **Rendered** and **Side by side**
views. Raw keeps the source editor; Side by side shows it beside the rendered
surface. The `Mermaid rendered tools` control selects **Preview** or **Visual**
for that surface, preserving the raw editor and its selection.

Mermaid source is the canonical representation. Visual mode never becomes a
second source of truth: every visual mutation is serialized back to Mermaid,
validated by the real Mermaid parser, and only then committed to the tab.

## Opening a diagram

- **From nothing:** choose **New GraphX diagram** in the new-tab (`+`) menu
  or in the command palette. To author Mermaid, create a `.mmd` file.
- **From the terminal, editor or Reader:** select a Mermaid snippet, right-click
  it and choose **Open Mermaid**. Fenced ` ```mermaid ` blocks are unwrapped
  automatically.
- **From Pi:** the `@crynta/pi-terax` extension exposes `mermaid.open` and
  `mermaid.update`. See [Pi Terax bridge](pi-terax.md) for payloads and limits.
- **From a workspace tab:** Mermaid tabs persist with the space, including their
  source and their private visual layout.

## Rendered markdown

A ` ```mermaid ` fence in rendered Markdown uses the GraphX preview in a
`.md` file or an AI chat message. The preview starts when the block comes
near the viewport. If neither engine accepts the source, the block shows the
original code.

Rendered fences are read-only. To edit one, switch the markdown tab to its raw
view, select the snippet and choose **Open Mermaid**.

## Raw source

Raw source supports **every** Mermaid format the bundled Mermaid 11 understands.
Nothing in this document restricts what you can write; the restrictions below
apply only to Visual mode.

- Sources up to 24 KiB use CodeMirror with a debounced live preview.
- Larger sources stay fully editable and persist normally, but live preview
  pauses to keep the UI responsive.
- Sources are capped at 48 KiB UTF-8.
- Preview runs Mermaid in strict security mode, disables HTML flowchart labels,
  ignores source directives that would change flowchart configuration, discards
  stale async renders, and displays the SVG as an inert image rather than
  injecting it into the DOM.

## Visual mode

Visual mode is a structured editor. It opens only when the current source parses
cleanly into a documented subset. Anything outside that subset leaves Visual
mode read-only with an explanation, and it can never overwrite your source.

Both editors support pointer drag and a keyboard equivalent for every drag, plus
an explicit control for every mutation. Undo and redo are available in Visual
mode; that history is transient UI state and is not persisted, returned through
Pi, or included in snapshots.

### Flowcharts

Supported source:

- Header `flowchart` or `graph` with direction `TB`, `TD`, `BT`, `RL`, or `LR`.
- Explicit nodes and inline endpoint declarations using the rectangle, rounded,
  stadium, circle, diamond, hexagon, database, and subroutine shapes.
- Connections `-->`, `---`, `-.->`, and `==>`, with an optional `|label|`.
- Plain-text labels.

Supported mutations: add, delete, and rename nodes; change node shape; move a
node on the canvas; add, edit, and delete connections; change diagram direction.
Deleting a node also removes its incident connections.

Positions are a Terax convenience, not Mermaid semantics. Mermaid source does
not encode absolute coordinates, so node positions are stored as **private
per-tab metadata**: bounded, hydrated defensively, saved with the space, cleared
when Pi replaces the source, and omitted from `app.snapshot`. Exporting or
copying the source gives you portable Mermaid that another renderer will lay out
its own way.

### Sequence diagrams

Supported source:

- `sequenceDiagram` header.
- Explicit or implicit participants, with `as` aliases.
- Participant kinds: participant, actor, boundary, control, entity, database,
  collections, queue. Mermaid only accepts `participant` and `actor` as
  declaration keywords, so the other six are written as shape metadata,
  `participant DB@{ "type": "database", "alias": "Store" }`, which is the form
  Visual mode reads and writes.
- Messages `->`, `-->`, `->>`, `-->>`, `-x`, `--x`, `-)`, `--)`, `<<->>`,
  and `<<-->>`.

Supported mutations: add, edit, delete, and reorder participants; add, edit,
delete, and reorder messages; change a message's sender, receiver, text, and
arrow kind. Deleting a participant cleans up messages that referenced it.

### Source-only constructs

These parse and render fine, but keep Visual mode read-only:

- Flowcharts: subgraphs, chained or multi-target links, styles, `classDef` and
  class assignments, click callbacks, HTML or Markdown labels, directives.
- Sequence diagrams: notes, boxes, loops, `alt` / `opt` / `par` / `critical` /
  `break` blocks, activation directives, `autonumber`, links, properties.
- Any diagram: frontmatter, directives, and comments.
- Participant labels containing `{` or `}`: Mermaid's shape-metadata block ends
  at the first closing brace, so braced labels stay outside the subset.
- Every other diagram type, including class, state, ER, Gantt, pie, git graph,
  mindmap, timeline, and quadrant charts.

To edit any of these, switch back to Raw or Side by side. Switching modes never rewrites
the source on its own.

## Shared document views

Use Raw / Rendered / Side by side to arrange source and rendered content. The source editor stays mounted across those changes. Preview / Visual selects the rendered-side surface; choosing Visual while Raw is selected reveals Side by side. Visual editing retains the supported subset and validation described above. Mermaid files (`.mmd`, `.mermaid`) use the same safe renderer without creating another tab, and save through the file editor. See [renderable views](renderable-views.md).
