# Mermaid diagrams

Terax has a first-class Mermaid tab: a split view with a source editor on the
left and a live diagram preview on the right. The same tab offers two editing
modes, **Source** and **Visual**, selectable from the `Mermaid editor mode`
control in the tab toolbar.

Mermaid source is the canonical representation. Visual mode never becomes a
second source of truth: every visual mutation is serialized back to Mermaid,
validated by the real Mermaid parser, and only then committed to the tab.

## Opening a diagram

- **From the terminal or an editor:** select a Mermaid snippet, then choose
  **Open Mermaid** in the selection popup. Fenced ` ```mermaid ` blocks are
  unwrapped automatically.
- **From Pi:** the `@crynta/pi-terax` extension exposes `mermaid.open` and
  `mermaid.update`. See [Pi Terax bridge](pi-terax.md) for payloads and limits.
- **From a workspace tab:** Mermaid tabs persist with the space, including their
  source and their private visual layout.

## Source mode

Source mode supports **every** Mermaid format the bundled Mermaid 11 understands.
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

To edit any of these, switch back to Source mode. Switching modes never rewrites
the source on its own.
