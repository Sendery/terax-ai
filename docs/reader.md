# Reader

The Reader reads a text aloud with the local voice and highlights each word as it is spoken. It is meant for long texts: articles, notes, specs and command output. It keeps the reading position, bookmarks and scripted pauses per document, and can export the reading as one audio file.

It opens in a panel docked under the tab you are working in, so a terminal, an editor or a Markdown view stays on screen while you listen. A reading can also have a Reader tab of its own.

It uses the speech stack described in [tts.md](tts.md). Nothing leaves the machine.

## Opening a text

- **From a terminal.** Terax terminals have a `terax-read` command:

  ```sh
  terax-read notes.md
  cat article.md | terax-read --title "Article"
  terax-read --no-play spec.md
  ```

  The text opens in the panel under the terminal that ran it, even if you have moved to another tab meanwhile: each Terax terminal exports `TERAX_PTY_ID`, and `terax-read` sends it along. Outside a Terax terminal it opens under the tab on screen. `--tab` opens a Reader tab instead.

  It calls the app binary with `--read`, which talks to the running Terax over the same local bridge as the MCP server. Outside Terax, run the binary directly: `/Applications/Pi-Terax.app/Contents/MacOS/terax --read notes.md`.
- **Right-click.** The terminal, the editor and both Markdown views (rendered and raw) share one set of reading actions:
  - **Speak** says the selection without showing it, with the default voice, a language or one voice;
  - **Read here** opens it in the panel under the tab; with nothing selected in an editor or a Markdown view it reads the whole document, unsaved edits included;
  - **Read here with** does the same with a voice chosen for that document;
  - **Read in new tab** opens it in a Reader tab;
  - **Stop** silences whatever is sounding, Speak or the Reader.
- **The selection popup** that a selection raises offers Read here, Read in new tab and Speak beside Ask Terax.
- **From the command palette:** Speak selection, Read here, Read in new tab, Show or hide the Reader panel, Play or pause the Reader, Resume and Stop. An entry that cannot apply to the tab on screen says why instead of disappearing: a private terminal, or a view with no text such as a preview or a diff.
- **From an agent.** Agents use `reader.open` with `text`, or with an absolute `path`. It docks in the panel unless they pass `placement: "tab"`, and it opens paused unless they pass `play: true`, so an agent never talks over what you are hearing. `tts.speak` is different: it is a short spoken message and plays at once.

Everything you start yourself plays at once. A reading picked from the library comes back paused, with the keyboard on its Play button, so Space or Return goes on.

Private terminals never read aloud: the right-click menu leaves the reading actions out, and the shortcuts and the palette say "Private terminal: reading aloud is off".

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

### From anywhere

These chords work from any tab while a reading is open, and can be changed in Settings, Shortcuts:

| macOS | Windows and Linux | Action |
| --- | --- | --- |
| ⌘⌥P | Ctrl+Alt+P | Play or pause. |
| ⌘⌥← ⌘⌥→ | Ctrl+Alt+← → | Previous or next sentence. |
| ⌘⌥= ⌘⌥- | Ctrl+Alt+= - | Faster or slower. |
| ⌘⌥R | Ctrl+Alt+R | Read here: the selection, or the document on screen, in the panel. |
| ⌘⌥B | Ctrl+Alt+B | Show or hide the Reader panel; in a Reader tab, open its list of readings. |
| ⌘⇧. | Ctrl+Shift+. | Stop whatever is sounding. |

They act on the reading that is sounding, else the one on screen, else the one left paused.

### The system's media controls

The Reader shows in the operating system's own media controls, and they drive it:

- **macOS:** Now Playing in Control Center and the menu bar, the play, previous and next keys, and AirPods or headphone buttons.
- **Windows:** the media overlay and the media keys.
- **Linux:** MPRIS players and the media keys.

The title is the document's, and the sentence being read shows as the second line. Previous and next move by sentence; skip back and forward move by 10 seconds; the position bar seeks. The webview has to support the Media Session API; `reader.state` reports it as `osMediaControls`.

The controls float over the workspace when the reading continues behind another tab, so it follows you as you work. With `f` they float even over the Reader tab itself.

## The Reader panel

The panel sits under the tab's content, and the content above shrinks to make room: a terminal keeps every row it shows, and a program such as Claude Code redraws once. Drag the panel's top edge to change its height, between about a fifth and four fifths of the space.

Each tab has its own panel, kept with the tab across restarts; a reading comes back paused. A Reader tab has no panel.

The panel never takes the keyboard on its own, so you keep typing in the terminal or the editor. Click the text to give it the keyboard: the shortcuts below then apply, and Escape hands the keyboard back. `q` closes the panel.

The header holds:

- the book button, which opens the list of readings;
- the document's title and where it came from;
- the progress;
- Move to a tab, which moves the reading to a tab of its own;
- close, which stops the reading unless a Reader tab or another panel still shows it.

When you switch to another tab, the reading goes on and the floating controls follow you.

A Reader tab's header has the same book button, and **Dock here**, which moves the reading back into the panel of the tab it was made in (or the last tab you worked in) and closes the Reader tab. Playback goes on.

## Readings

The book button lists every reading made so far, newest first, with the tab it was made in, its size, its progress and when it was last read. Click one to go back to it, at the point where it stopped.

The chain button at the top decides where it opens:

- **Chain on** (the default): it opens in the panel of the tab it was made in, and Terax switches to that tab. If that tab is closed, it opens here.
- **Chain off**: it opens in the panel you are looking at, and you stay on this tab.

Picked from a Reader tab, which has no panel, it goes to the last tab you worked in. **Resume** in the palette follows the same rules with the newest reading, and plays it.

The list's footer points at the other history: short texts said with Speak are under the clock in the status bar, whose footer points back here.

A reading belongs to the first tab it was opened in while that tab stays open. Tabs keep their identity across restarts for this, even though their numbers change.

The bin button on a row deletes that reading and its audio. Delete all, then a second click to confirm, empties the library. Panels and Reader tabs that showed a deleted reading let go of it.

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

- `origin`: the `key` of the tab the reading belongs to and its `label` then;
- `playback_state`: `status`, `last_position_ms`, `last_word_index` and `speed`;
- `cut_points`: each with `kind`, `label`, `word_index`, `timestamp_ms`, `pause_after_ms` and `source`;
- `segments`: for each segment already made, its `chunk_file`, `start_ms`, `end_ms` and every word with `char_start`, `char_end`, `start_ms` and `end_ms`. Above 40,000 words the per-word list is left out.

The manifest can be edited outside Terax. Fields that do not validate are dropped on load.

Clips already made are played from disk. A document listened to once plays again with the speech engine stopped.

## Export

`e`, or Export audio in the controls' menu, makes any missing clips and writes `exports/<title>.wav` with the scripted pauses in place. When the document has headings or bookmarks, the export also writes `<title>.chapters.json` and a `<title>.cue` sheet. A CUE sheet holds at most 99 tracks; the JSON keeps every chapter.

### Fragments

For long texts, the same menu exports the reading in pieces, one WAV each:

- **One file per section:** a section starts at each heading; whatever comes before the first heading is a section too.
- **One file per paragraph:** a paragraph, list item, quote or table row each, with a heading joined to the block it introduces.
- **One file per sentence:** each segment the audio is made in.

The files go to `exports/<title> (<split>)/`, numbered in reading order (`01 Introduction.wav`, `02 ...`), with `index.json` (title, path, start and length of each) and `playlist.m3u`. The folder is replaced on each export, so fragments of an earlier split never linger. Scripted pauses stay inside a fragment; the one after its last sentence is dropped.

## Agents

| Command | Policy | MCP |
| --- | --- | --- |
| `reader.open` | act | `terax_speak open_reader` |
| `reader.list` | read | `terax_inspect list_reader_documents` |
| `reader.state` | read | `terax_inspect reader_state` |
| `reader.control` | act | `terax_speak control_reader` |
| `reader.mark` | act | `terax_speak mark_reader` |
| `reader.export` | act | `terax_speak export_reader` |
| `reader.dock` | act | `terax_speak dock_reader` |
| `reader.delete` | approve | `terax_speak delete_reader_documents` |
| `reader.generate` | act | `terax_speak generate_reading` |

Without a `docId`, a command acts on the document playing, else on the one on screen (a Reader tab or the panel of the tab on screen), else on the reading left paused. `reader.state` never changes the screen; the other commands dock a named document that nothing shows under the tab on screen.

- `reader.open` takes `placement` (`dock`, the default, or `tab`) and `tabId` to dock under a tab other than the one on screen.
- The app snapshot shows `readerPanel: { docId }` on every tab with a panel open, except private terminals.
- `reader.list` adds `originTabId`, the open tab a reading belongs to, and `shownInTabIds`.
- `reader.dock` shows a document (`docId`) or the readings list in a tab's panel, or closes it with `close`.
- `reader.delete` deletes one reading (`docId`) or all of them (`all`), with their audio. It asks for approval.
- `reader.export` takes `split` (`none`, the default, `heading`, `paragraph` or `sentence`) and `voiceId`.
- `reader.generate` turns a `text`, an absolute `path` or a `docId` into audio fragments without opening anything: `split` defaults to `paragraph`, `voiceId` sets the voice, `title` names the folder and `show` also docks it on screen. It answers with the `docId` and the number of fragments planned.
- Both start the work and answer at once, because the bridge gives up on a call after 15 seconds and a long text takes minutes. Poll `reader.state`: its `export` field is `running` with `done` and `total`, then `done` with the file or the list of fragments, or `failed` with the error. One export runs at a time.

- `reader.state` returns the word being read and its index, the position and total time, the speed, the voice and every cut point.
- `reader.control` takes an `op` (`play`, `pause`, `toggle`, `stop`, `next`, `previous` or `seek`). It is not called `action` because MCP tools use that name to pick the action. It also takes an optional `wordIndex` or `positionMs`, and an optional `speedPercent` from 75 to 250. `pause` and `stop` with the `docId` of a document that is not playing change nothing.

## Limits

- Texts up to 2 MiB. Through the bridge, a `text` argument is limited to 300,000 characters; longer texts go by `path`. `terax-read` handles this on its own.
- One document plays at a time. Starting "read aloud" elsewhere pauses the Reader, and the Reader stops "read aloud".
- The export is WAV only.
- Read here on an editor with unsaved edits reads the buffer as a new document, so it does not reopen the saved file's reading.
- Audio made for a sentence that later changed, or for a voice no longer used, stays in the document's folder until the reading is deleted.
- Kokoro reads its Spanish voices through espeak, so the language guess only picks the default voice. Choose a voice for each document in the controls.
