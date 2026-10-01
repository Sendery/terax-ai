# Mermaid Visual Editing Implementation Plan

> **For Hermes:** Execute each slice with strict RED, GREEN, refactor discipline and independently verify the final diff.

**Goal:** Add non-destructive structured visual editing for Mermaid flowcharts and sequence diagrams while preserving full text editing for every Mermaid format.

**Architecture:** Keep Mermaid source as the canonical semantic representation. A conservative parser admits only a documented visual subset; unsupported constructs keep the Visual mode read-only and can never be overwritten. Flowchart coordinates live as private per-tab metadata because Mermaid source does not encode absolute positions. Sequence participant and message ordering is serialized directly into source. UI code remains lazy and uses the repository's existing dnd-kit wrapper.

**Tech stack:** React 19, TypeScript, Vitest, Mermaid 11.17.0, dnd-kit, CodeMirror, Tauri runtime QA.

---

## Invariants

- All Mermaid formats remain available in Source mode.
- Visual mode never rewrites unsupported, malformed, or stale source.
- Visual operations produce valid Mermaid accepted by the real 11.17.0 parser.
- Source remains limited to 48 KiB UTF-8 and is never exposed by `app.snapshot`.
- Flowchart positions are private, bounded, finite, hydrated defensively, and omitted from public snapshots.
- No new dependency and no eager startup import.
- Pointer drag has keyboard equivalents and every mutation has an accessible control.
- Visual history supports undo and redo without bypassing source validation.
- No comments or text use em dash characters.

## Supported flowchart subset

- Header: `flowchart` or `graph` with `TB`, `TD`, `BT`, `RL`, or `LR`.
- Explicit nodes and inline endpoint declarations using rectangle, rounded, stadium, circle, diamond, hexagon, database, and subroutine shapes.
- Connections: `-->`, `---`, `-.->`, and `==>`, with optional `|label|`.
- Plain text labels without HTML, Markdown, directives, callbacks, styles, classes, subgraphs, chained links, or multi-target syntax.
- Visual mutations: add, delete, rename, change shape, move node, add/edit/delete connection, change direction.

## Supported sequence subset

- `sequenceDiagram` header.
- Explicit or implicit participants.
- Participant kinds: participant, actor, boundary, control, entity, database, collections, queue.
- Aliases with `as`.
- Message kinds: `->`, `-->`, `->>`, `-->>`, `-x`, `--x`, `-)`, `--)`, `<<->>`, `<<-->>`.
- Visual mutations: add/edit/delete/reorder participants; add/edit/delete/reorder messages; change sender, receiver, text, and arrow kind.
- Notes, boxes, loops, alt/opt/par/critical/break blocks, activation directives, autonumber, links, properties, frontmatter, directives, and comments remain Source-only.

### Task 1: Flowchart functional core

**Files:**
- Create: `src/modules/mermaid/lib/flowchartModel.ts`
- Test: `src/modules/mermaid/lib/flowchartModel.test.ts`

1. Write failing tests for valid parse, inline nodes, deterministic serialization, all supported shapes/edges, rejection of advanced syntax, ID generation, node deletion with incident edges, connection mutation, and real Mermaid parse of generated source.
2. Run the focused test and confirm RED.
3. Implement minimal types, parser, serializer, and pure mutation helpers.
4. Run focused tests to GREEN, then typecheck and Biome.

### Task 2: Sequence functional core

**Files:**
- Create: `src/modules/mermaid/lib/sequenceModel.ts`
- Test: `src/modules/mermaid/lib/sequenceModel.test.ts`

1. Write failing tests for explicit/implicit participants, aliases and kinds, every arrow kind, deterministic serialization, unsupported block rejection, add/edit/delete/reorder operations, referential cleanup, and real Mermaid parse of generated source.
2. Run focused RED.
3. Implement minimal parser, serializer, and pure mutations.
4. Run focused GREEN, typecheck, and Biome.

### Task 3: Private flowchart layout persistence

**Files:**
- Modify: `src/modules/tabs/lib/useTabs.ts`
- Modify: `src/modules/tabs/index.ts`
- Modify: `src/modules/spaces/lib/serialize.ts`
- Modify: `src/modules/spaces/lib/mermaid-serialize.test.ts`
- Modify: `src/modules/commands/lib/snapshot.test.ts`

1. Add failing round-trip, corrupt-layout, bounds, and snapshot-redaction tests.
2. Confirm RED.
3. Add a bounded `MermaidVisualLayout` type, mutation API, serialization and defensive hydration.
4. Confirm GREEN and run adjacent tab/space/snapshot tests.

### Task 4: Visual history and source synchronization

**Files:**
- Create: `src/modules/mermaid/lib/visualHistory.ts`
- Test: `src/modules/mermaid/lib/visualHistory.test.ts`

1. Add failing tests for commit, undo, redo, future clearing, stale text invalidation, and history cap.
2. Confirm RED.
3. Implement a pure bounded reducer.
4. Confirm GREEN.

### Task 5: Flowchart canvas

**Files:**
- Modify: `src/modules/dnd/index.ts`
- Create: `src/modules/mermaid/components/FlowchartVisualEditor.tsx`
- Create: `src/modules/mermaid/components/FlowchartVisualEditor.test.tsx` or pure interaction planner tests where DOM support is insufficient.

1. Add failing tests for pointer/keyboard move planning, bounded coordinates, node selection, add/edit/delete operations, and edge form behavior.
2. Confirm RED.
3. Build an accessible absolute-position canvas using `useDraggable`, SVG edge projection, a properties panel, and keyboard arrow movement.
4. Confirm GREEN and inspect constrained layouts.

### Task 6: Sequence structured editor

**Files:**
- Create: `src/modules/mermaid/components/SequenceVisualEditor.tsx`
- Create: `src/modules/mermaid/components/SequenceVisualEditor.test.tsx` or pure interaction planner tests.

1. Add failing tests for participant horizontal sorting, message vertical sorting, keyboard sorting, forms, deletion cleanup, and empty states.
2. Confirm RED.
3. Build participant and message sortables with PointerSensor and KeyboardSensor plus explicit move controls.
4. Confirm GREEN.

### Task 7: Lazy mode integration

**Files:**
- Create: `src/modules/mermaid/MermaidVisualEditor.tsx`
- Create: `src/modules/mermaid/MermaidVisualEditorLazy.tsx`
- Modify: `src/modules/mermaid/MermaidStack.tsx`
- Modify: `src/modules/mermaid/index.ts`
- Modify: `src/app/eager-budget.test.ts`

1. Add failing tests proving the visual editor is lazy and unsupported syntax cannot emit source changes.
2. Confirm RED.
3. Add Source/Visual segmented controls, loading and unsupported states, validated source commits, layout commits, undo/redo, and safe fallback after text edits.
4. Confirm GREEN, eager budget, types, and Biome.

### Task 8: Documentation and full verification

**Files:**
- Modify: `docs/pi-terax.md`
- Modify: relevant Mermaid user documentation introduced by this branch.

1. Document supported visual syntax and Source-only constructs without claiming free positioning in exported Mermaid.
2. Run full frontend tests, types, build, size, production audit, Pi package tests/build, Rust Clippy and lib tests, changed-file Biome, and `git diff --check`.
3. Run Tauri under isolated XDG paths. Exercise flowchart drag/edit/source regeneration and sequence participant/message create/edit/reorder. Exercise unsupported syntax lockout and confirm no source mutation.
4. Capture and inspect Source, flowchart Visual, sequence Visual, and unsupported states.
5. Request independent security, correctness, performance, accessibility, and UX review of the final diff.
6. Commit and merge into QA only after all gates pass and no blocker remains.
