# Terminal text fidelity: QA plan

Status: in progress on `qa-terminal-fidelity` (branched from `qa` at dev.27).

## What the user reported

1. Line breaks are not always respected; some sentences change when the
   terminal is resized.
2. Copying a multi-line selection sometimes loses the newline between lines.
3. The reverse: a long sentence that only wrapped on screen is copied with
   newlines inside it.
4. In terminals running Claude Code, scrolling up shows the Claude Code
   interface several times instead of the earlier history.

Screenshots (tabs "slot-5 WORKPLACES" and "terax-ai") show two different lines
joined in one row with a wide gap between them, and the Claude Code banner
next to "Conversation compacted".

## Method

- **Engine tests** (`src-tauri/src/modules/pty/engine/fidelity_tests.rs`) drive
  the pinned libghostty-vt through the same filter as the engine, with the
  `ghostty-engine` feature, no UI.
- **Real captures** (`scripts/terminal-qa/capture.py`) record what zsh with the
  user's configuration and Claude Code 2.1.322 actually write, including
  resizes. The ignored test `replay_capture` replays them into the engine and
  counts markers in the history.
- **Manual QA** in a sandbox build for what only the app shows (gestures,
  selection by mouse, panels).

## Findings

| # | Symptom | Cause | Evidence | Fix |
|---|---------|-------|----------|-----|
| F1 | 2 and the joined rows in the screenshots | Ghostty keeps a row's soft-wrap flag on EL 2 (`ESC[2K`), on purpose, to match xterm. Ink programs repaint by erasing whole lines, so a row split by the reflow stays marked as continuing into a row that now holds another line. Copy joins them without a newline; widening joins them into one row with a gap. | `pinned_ghostty_keeps_the_soft_wrap_on_erase_complete_line`: copy gives `"X         Y"`. EL 0, ECH and ED 0 do reset the flag. | Done: the engine follows every EL 2 with an EL 0 (`erase_wrap.rs`), which changes no cell. |
| F2 | 4 | Claude Code repaints the whole screen on every SIGWINCH without clearing the history, and Terax sent one resize per animation frame during a drag or an animated panel. Each repaint whose rows overflow the screen leaves a copy behind; enough copies push the real history out of the scrollback limit. | Replay of a real capture after 80 lines of shell history: a 20-step drag leaves the Claude Code banner 20 times in the history, a single resize leaves it once. | Done: resizes are coalesced per gesture (`RESIZE_SETTLE_MS` 120). |
| F3 | 1 (zsh, bash) | On SIGWINCH zsh moves up the rows its prompt and typed command took at the old width, erases to the end of the screen and repaints; readline does the same for the last prompt line. The terminal has already reflowed those rows, so the count is stale: narrowing leaves a second copy of the first prompt row, widening erases output above the prompt. The cure is to blank the prompt before the reflow. libghostty has that (`OSC 133;A;redraw=1`) but the C API turns it off by default, and at the pinned commit it is wrong for a prompt that wraps: `Screen.resize` blanks the cells and leaves the rows soft-wrapped, so the blank rows are rejoined or split by the reflow, and it leaves the cursor in a column that may no longer exist, which adds a row. Its prompt search also walks up through unmarked rows to an older prompt and would blank real output. | `zsh_narrowing_alone_duplicates_the_first_prompt_row_without_the_erase`, `zsh_widening_alone_erases_output_without_the_erase`, `pinned_ghostty_redraw_keeps_the_soft_wrap_of_a_wrapped_prompt`. Real zsh 5.9 and bash 5.3 captures with a two-line prompt across nine resizes: before, output lines lost and prompt rows repeated; after, the history reads the same at every width. | Done: the engine blanks the prompt itself before a change of width (`prompt_redraw.rs`): ED 0 from the prompt's first row, which also drops the soft wraps, cursor parked at the left edge. It acts only on marks signed with the session token and only between a prompt start that promises the repaint (`133;A;...;terax_redraw=1`) and the next `C` or `D`; the row comes from the last signed `133;P` mark, which zsh carries at the start of `PS1` and bash at the start of every prompt line and of `PS2`. `133;B` moved to the end of `PS1`. Never `redraw=`, so libghostty's own erase stays off. fish is unchanged (no promise, not verified). |
| F4 | 3 | Claude Code wraps paragraphs itself: hard newlines and a two-column indent (`CSI 2 G`), and it places words with `CSI G` instead of spaces. The terminal cannot tell those newlines from real ones. Ghostty, iTerm2 and others copy the same. | Capture: `Quick[8Gsafety[15Gcheck:` and continuation lines starting at column 2. | In progress (Fable): rejoin wrapped paragraphs when copying from an agent pane, with a way to copy exactly as shown. |

Verified correct, no change needed: soft-wrapped lines copy as one line;
hard newlines, lines that exactly fill the row and blank lines survive copy;
wide characters at the wrap edge add no newline or space; narrowing and
widening restore soft-wrapped lines and never join lines that ended in a
newline; history survives reflow; `ESC[3J` clears the history.

Known and outside the terminal: when Claude Code's repaint is taller than the
screen at the new width, rows scroll into the history before it finishes;
every reflowing terminal shows that once per resize.

## Automated scenarios

| Id | Scenario | Test |
|----|----------|------|
| C1 | Soft-wrapped line copies as one line | `copy_keeps_a_soft_wrapped_line_as_one_line` |
| C2 | Hard newlines kept | `copy_keeps_hard_newlines` |
| C3 | Newline after a row filled exactly | `copy_keeps_the_newline_after_a_line_that_exactly_fills_the_row` |
| C4 | Blank lines kept | `copy_keeps_blank_lines_between_paragraphs` |
| C5 | Wide character at the wrap edge | `copy_of_a_wrapped_line_with_wide_characters_has_no_newline` |
| R1 | Narrow and widen restore soft wraps | `narrowing_and_widening_restores_soft_wrapped_lines` |
| R2 | Resizing never joins hard lines | `resizing_never_joins_lines_that_ended_in_a_newline` |
| R3 | History survives reflow | `resizing_keeps_history_that_is_in_the_scrollback` |
| S1 | Ink frame shorter than the screen repaints in place | `an_ink_frame_shorter_than_the_screen_redraws_in_place` |
| S2 | `ESC[3J` clears history | `erase_scrollback_clears_history` |
| S3 | Ink repaint after narrowing (known limit) | `an_ink_frame_after_a_narrowing_resize_leaves_its_reflowed_rows_in_history` |
| W1 | EL 2 then rewrite: copy keeps the newline | `erasing_and_rewriting_a_wrapped_row_drops_its_soft_wrap` |
| W2 | Reflow, repaint, widen: no joined rows | `reflow_then_tui_repaint_does_not_join_lines_when_widening` |
| W3 | Pinned Ghostty still keeps the flag (filter still needed) | `pinned_ghostty_keeps_the_soft_wrap_on_erase_complete_line` |
| E1 | Filter: EL 2 only, split reads, string payloads | `erase_wrap::tests` |
| G1 | A drag sends one resize; a gesture back to the start sends none | `engineSession.test.ts`, "coalesces a resize gesture" |
| P1 | zsh prompt of one, two and three lines with a long typed command, nine widths | `prompt_redraw_tests::zsh_*_prompt_survives_narrowing_and_widening` |
| P2 | bash prompt of one and two lines, nine widths | `prompt_redraw_tests::bash_*_prompt_survives_narrowing_and_widening` |
| P3 | Same streams without the erase lose output and repeat rows (the cause) | `without_the_promise_the_repaint_corrupts_the_history` and the two `zsh_*_alone_*` tests |
| P4 | Nothing erased: running or finished command, unsigned or forged marks, no promise, alternate screen, mid-sequence, prompt start off screen, same width | `prompt_redraw_tests`, the `nothing_is_erased_*` group and its neighbours |
| P5 | Block mode prompt keeps its reserved rows; engine session with and without blocks | `block_mode_prompt_keeps_its_reserved_rows`, `the_engine_erases_the_prompt_before_it_reflows` |
| P6 | Pinned libghostty still keeps soft wraps in its own prompt erase | `pinned_ghostty_redraw_keeps_the_soft_wrap_of_a_wrapped_prompt` |
| P7 | Signed `P` marks and the promise on `A` | `shell::prompt_revision_tests` |

Replays (manual run of `replay_capture`, captures in the scratch area):
Claude Code with history across five resizes; Claude Code 20-step drag vs one
resize; zsh with the user's prompt, plain and with Terax integration.
Shell prompts go through `prompt_redraw_tests::replay_capture_through_prompt_redraw`,
which adds the signed marks and the prompt erase of the engine session: zsh
with a two-line and a one-line prompt, a theme hook that rebuilds `PS1`, block
mode, and bash 5.3 and 3.2.

## Manual QA in a sandbox build

1. Shell: `cat` a file with long lines, select several lines with the mouse,
   copy, paste into an editor: same lines, no extra or missing newlines.
2. Shell: one very long line that wraps three times: copy gives one line.
3. Drag a split divider for two seconds with Claude Code running, then scroll
   up: at most one extra copy of its screen.
4. Toggle the sidebar, the AI chat dock and the Reader dock with Claude Code
   running: no repeated banners.
5. Resize the window live: same as 3.
6. zsh with a two-line prompt: resize narrow and wide several times: no lost
   output above the prompt, no repeated prompt rows.
7. Copy a long Claude Code answer: paragraphs come out as paragraphs; "Copy as
   shown" keeps the screen layout.
8. vim and less (alternate screen): resize and quit; the shell history is
   intact.
9. tmux inside Terax: copy and resize behave as in 1 to 6.
10. Wide characters and emoji at the right edge: copy has no stray spaces.

## Follow-ups

- Reset the previous row's soft wrap too when EL 2 erases a continuation row.
  The stream filter cannot reach the row above; it needs a change in the
  native core (`eraseLine`, `.complete`), built on the M2 producer.
- Report F1 upstream to Ghostty as a behaviour note: xterm compatibility
  versus copy and reflow of repainted lines.
- Report F3 upstream: in `Screen.resize`, the `prompt_redraw` erase should
  also clear `row.wrap` and `row.wrap_continuation` on the rows it blanks and
  move the cursor to column 0. With that fixed in the native core Terax could
  send `redraw=1`, but the signed anchor is still the safer way to find the
  prompt.
- fish: check what it repaints on a resize and whether it needs the promise.
- bash 3.2 (no `PS0`, so no pre-exec mark) and prompts with a literal
  newline in `PS1` make no promise and keep the old behaviour.
