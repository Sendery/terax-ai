# Reader

The Reader is a tab that reads a text aloud with the local voice and highlights each word as it is spoken. It is meant for long texts: articles, notes, specs and command output. It keeps the reading position, bookmarks and scripted pauses per document, and can export the reading as one audio file.

It uses the speech stack described in [tts.md](tts.md). Nothing leaves the machine.

## Opening a text

- **From a terminal.** Terax terminals have a `terax-read` command:

  ```sh
  terax-read notes.md
  cat article.md | terax-read --title "Article"
  terax-read --no-play spec.md
  ```

  It calls the app binary with `--read`, which talks to the running Terax over the same local bridge as the MCP server. Outside Terax, run the binary directly: `/Applications/Pi-Terax.app/Contents/MacOS/terax --read notes.md`.
- **From a terminal selection.** Right-click, then choose Open in Reader.
- **From the command palette:**
  - Open selection in Reader.
  - Open this file in Reader, when an editor or Markdown tab is active.
  - Resume last Reader document.
- **From an agent.** Agents use `reader.open` with `text`, or with an absolute `path`.

The same text always reopens the same document, because its id is a hash of the text, so reopening it resumes where it stopped.

## Reading

The column is about 72 characters wide. Text still ahead is dimmed, the sentence being read is lit, and the word being spoken is marked in amber. Text already read stays legible but steps back. A green triangle in the margin marks the saved reading point.

| Key | Action |
| --- | --- |
| Space | Play or pause. With a cursor placed, play from it. |
| Click | Read from that word. Alt+click only moves the cursor. |
| ← → | Previous or next sentence. |
| ⇧← ⇧→ | Back or forward 10 seconds. |
| j k ↑ ↓, PageUp PageDown | Scroll freely. Reading continues, and a button leads back to the reading point. |
| w b | Move the cursor one word. |
| { } | Move the cursor one paragraph. |
| Enter | Read from the cursor. |
| c | Back to the reading point. |
| m | Bookmark before the cursor word. |
| p | Scripted 1.5-second pause before the cursor word. |
| P | Stop before the cursor word. |
| [ ] Tab ⇧Tab | Previous or next cut point. |
| + - | Speed, from 0.75x to 2.5x. |
| f | Float the controls, or dock them under the text. |
| e | Export the audio. |
| q | Save and close the tab. |
| ? | Show the shortcuts. |

The controls float over the workspace when the reading continues behind another tab, so it follows you as you work. With `f` they float even over the Reader tab itself.

## How the audio is made

The text is split into segments and each segment is synthesized on its own:

- one sentence;
- one heading;
- one list item;
- one table row, with commas between the cells.

Long sentences are wrapped at 280 characters, and very short ones join the next. Code blocks are shown but not read. Bare URLs are shown but skipped in speech.

The highlight is estimated, not measured. Each segment's clip has a known length, and that length is shared out among its words by how long they take to say, with extra time after commas and at the end of a sentence. Because a segment is one short utterance, the estimate stays close. No engine has to report timings, and no audio has to be analysed for cuts.

Speed is applied when the audio plays, not when it is made. The same clips therefore serve every speed.

## Cut points

- **Bookmark** (`m`, cyan flag): a start point. `[`, `]` and Tab jump between cut points. In study mode, set from the controls' menu, playback stops at every bookmark.
- **Pause** (`p`, amber bars): silence before the word, 1.5 seconds by default.
- **Stop** (`P`, red square): playback halts before the word. Pressing play reads through it.

Pauses and stops can also be written in the text itself: `[pause: 2s]`, `[pause: 800ms]`, `[pausa: 1,5s]` or `[stop]`. These come from the text, so they are rebuilt on every load and cannot be removed from the Reader.

A pause or stop in the middle of a sentence splits that sentence into two clips. Only the clip whose text changed is made again.

## Storage

Each document lives in `<app_local_data_dir>/reader/<id>/`:

```text
reader/<id>/
├── source.txt        the text, normalized
├── manifest.json     reading state, cut points and per-segment timings
├── chunks/<voice>/   one WAV per segment, per voice
└── exports/          exported audio
```

The library sits beside the speech directory, not inside it, so removing the speech engines from Settings never deletes what was read.

`manifest.json` is the script of the reading, written in snake_case:

- `playback_state`: `status`, `last_position_ms`, `last_word_index` and `speed`;
- `cut_points`: each with `kind`, `label`, `word_index`, `timestamp_ms`, `pause_after_ms` and `source`;
- `segments`: for each segment already made, its `chunk_file`, `start_ms`, `end_ms` and every word with `char_start`, `char_end`, `start_ms` and `end_ms`. Above 40,000 words the per-word list is left out.

The manifest can be edited outside Terax. Fields that do not validate are dropped on load.

Clips already made are played from disk. A document listened to once plays again with the speech engine stopped.

## Export

`e`, or Export audio in the controls' menu, makes any missing clips and writes `exports/<title>.wav` with the scripted pauses in place. When the document has headings or bookmarks, the export also writes `<title>.chapters.json` and a `<title>.cue` sheet. A CUE sheet holds at most 99 tracks; the JSON keeps every chapter.

## Agents

| Command | Policy | MCP |
| --- | --- | --- |
| `reader.open` | act | `terax_speak open_reader` |
| `reader.list` | read | `terax_inspect list_reader_documents` |
| `reader.state` | read | `terax_inspect reader_state` |
| `reader.control` | act | `terax_speak control_reader` |
| `reader.mark` | act | `terax_speak mark_reader` |
| `reader.export` | act | `terax_speak export_reader` |

Without a `docId`, a command acts on the document playing, else on the Reader tab on screen, else on the reading left paused.

- `reader.state` returns the word being read and its index, the position and total time, the speed, the voice and every cut point.
- `reader.control` takes an `op` (`play`, `pause`, `toggle`, `stop`, `next`, `previous` or `seek`). It is not called `action` because MCP tools use that name to pick the action. It also takes an optional `wordIndex` or `positionMs`, and an optional `speedPercent` from 75 to 250.

## Limits

- Texts up to 2 MiB. Through the bridge, a `text` argument is limited to 300,000 characters; longer texts go by `path`. `terax-read` handles this on its own.
- One document plays at a time. Starting "read aloud" elsewhere pauses the Reader, and the Reader stops "read aloud".
- The export is WAV only.
- Kokoro reads its Spanish voices through espeak, so the language guess only picks the default voice. Choose a voice for each document in the controls.
