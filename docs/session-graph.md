# Session history panel

A third panel beside Notes and Tasks that shows the transcript of the agent
running in the focused terminal as a top-down, git-style graph.

Open it from the branch icon in the header, or with `history.show` /
`history.hide` / `history.toggle`. Like the scheduler panel it stays closed until
asked for, and its width and visibility persist.

## Why it works the way it does

The graph is **read out of the transcript, not inferred**. Both supported agents
already persist a parent/child tree — pi writes `id`/`parentId`, Claude writes
`uuid`/`parentUuid` — and for both, HEAD is the last entry in file order. A
rewind therefore already appears as two children of one entry, so branches are
real data rather than a reconstruction.

Two things follow from that, and they shape the whole feature:

- **A running agent owns its transcript.** It appends to the file and holds its
  leaf in memory, so nothing here ever modifies a live session. Branching writes
  a *new* session file instead.
- **The agents differ, and the UI says so.** pi records no file snapshots at
  all, so restoring code is Claude-only. Claude has no `--session <path>`, so
  branching into a new session is pi-only. Unavailable actions stay visible with
  the reason attached rather than disappearing.

## What it includes

| Area | Behaviour |
|---|---|
| Graph | Top-down commit graph; lane colour and curve carry branch structure |
| Node glyphs | Icon inside each node says what happened: user turn, shell, read, edit, subagent, web, plan, question, reasoning, session setting; tool output is a plain dot |
| Zoom | Three densities — Overview, Compact, Full — with zoom in/out |
| Collapsed groups | Agent work between user turns folds into one chip with a count and a colour-coded tool tally (max 3 + `+N`) |
| Real user turns | Injected context (`<command-message>`, `<task-notification>`, skill preambles) is detected and never counted as a turn |
| Previews | One line per row, truncated; full text, kind, tools and timestamp in a hover card |
| Key points | Right-click to mark an entry with your own label and colour; marked rows get an accent and are never collapsed |
| Outline | Filterable index of user turns and key points, with the current position highlighted |
| Scroll rail | Continuous scrollbar with a tick per user turn and a coloured pip per key point; hover reveals the text |
| Branches | Switch between the alternatives a rewind left, with size and which one HEAD is on |
| Forked sessions | Follow `parentSession` to the session this one came from, or into the ones branched off it |
| Actions | Branch from a point into a new session (pi), copy a resume command, restore code (Claude, when a snapshot exists) |
| Live | Follows a running agent by byte offset, reading only the appended bytes |

## Visual test checklist

Each item is something to look at, not just assert. Open the panel on a terminal
whose directory has transcripts.

**Graph and glyphs**

- [ ] User turns render as a large filled disc with a chat glyph, in bold text,
      on a tinted row.
- [ ] Shell steps are amber terminals, reads are cyan magnifiers, edits are
      green pencils, subagents are fuchsia — colour and icon agree.
- [ ] Tool output rows are plain grey dots with no icon, and read as background.
- [ ] Reasoning-only entries say `thinking…`, never `(no text)`.
- [ ] The lane line enters and leaves each node cleanly, and **no line hangs
      below the last node of a branch**.

**Branches**

- [ ] A rewind draws an elbow into its own lane, and the main line continues
      below it.
- [ ] Rows of an abandoned branch are tinted in that lane's colour and dimmed.
- [ ] The header shows `N br` when the session has abandoned branches.
- [ ] Switching branch moves the highlight to the other alternative, and the
      `on branch ×` chip appears and clears.

**Zoom and density**

- [ ] Overview shows only real user turns, with a count chip between them.
- [ ] The tally is colour-coded per tool family, capped at three chips plus
      `+N`, and **never clipped at the right edge**.
- [ ] Long tool names shorten (`mcp__notion__search` → `search`).
- [ ] Zooming to Full reveals every entry; zoom buttons disable at the ends.
- [ ] Expanding one turn does not leave the chosen density.

**Key points**

- [ ] Right-clicking a row offers marking it; the label input focuses.
- [ ] A marked row keeps a coloured accent stripe and a chip with the label.
- [ ] A marked entry stays visible at Overview density.
- [ ] The mark appears as a coloured pip on the scroll rail and in the outline.
- [ ] Marks survive a reload of the app.

**Navigation**

- [ ] The outline lists turns numbered, filters as you type, and highlights the
      current position.
- [ ] Clicking a rail tick or an outline row scrolls to that entry.
- [ ] The up/down buttons jump between user turns and stop at the ends.
- [ ] Hovering a rail tick reveals the turn's text without widening the panel.

**Forked sessions**

- [ ] A session with `parentSession` offers "forked from …"; its parent offers
      "branched into …".
- [ ] Opening a forked session swaps the graph and shows the `forked ×` chip.
- [ ] Changing terminal clears branch and fork navigation.

**Actions**

- [ ] "Branch from here" asks for confirmation before writing.
- [ ] After branching, the new session appears in the fork list of the original.
- [ ] The original transcript is unchanged (compare its byte size).
- [ ] On a Claude entry, "Restore code" shows how many files it covers; on pi it
      is disabled and explains that pi records no snapshots.
- [ ] "Copy resume command" copies a runnable command.

**Scale and edge cases**

- [ ] A transcript with thousands of entries scrolls smoothly (rows are
      windowed).
- [ ] A session being written live shows the `live` marker and grows without
      re-reading the file.
- [ ] A terminal with no transcript shows an explanatory message, not an empty
      graph.
- [ ] A turn that carried only an attachment renders `(no text)` rather than a
      blank row.

## Capturing evidence

Use `terax_visual_qa`. Two things make captures fail in a dev build, both
learned the hard way:

- The window must be **frontmost**; an occluded webview is throttled and the
  capture never resolves.
- Capture right after a **clean start**. Accumulated HMR reloads break the
  rasterization path.

Also check the `pid` in the tool's `window` block against your dev build: the
bridge discovery file is global, so the most recently started Terax instance
owns it, and evidence can silently come from the wrong app.

## Captured evidence

Screenshots live under `.terax/visual-qa/` in the project (git-ignored, one
directory per capture with `screenshot.png` and `result.json`). Each was taken
from a dev build and bound to that build's PID.

| # | What it shows | Directory |
|---|---|---|
| 02 | Panel first rendering a real Claude transcript beside Notes and Tasks | `20260807T083524.410Z-02-panel-historico-abierto-hPcVMZ` |
| 03 | Tool-result bodies and `thinking…` replacing blank `(no text)` rows | `20260807T083802.458Z-03-panel-previews-corregidas-Rctkre` |
| 04 | Header on one line; no edge hanging below a branch's last node | `20260807T084041.225Z-04-defectos-corregidos-vYQ1mt` |
| 05 | Overview density: count chips with tool tallies, 227 nodes → 30 rows | `20260807T093103.670Z-05-rediseno-overview-2Dt9KJ` |
| 08 | Solid tone discs with dark glyphs, tally capped at 3 + `+N` | `20260813T233632.234Z-08-discos-solidos-y-chips-rGcP7t` |
| 09 | Full density: the icon vocabulary per process | `20260813T233936.066Z-09-densidad-full-iconos-por-proceso-Hmvxo1` |
| 10 | Branch/fork control in the header, truncated tool names | `20260814T002739.097Z-10-fase4-ramas-y-forks-yHyIiw` |
| 11 | A real rewind in a live session: purple elbow into a tinted spur lane | `20260814T005425.451Z-11-final-fase5-GwjIq9` |

Not captured, because the bridge cannot open a menu: the branch switcher popover,
the outline popover, and the entry context menu. Those are the items to walk
manually from the checklist above.
