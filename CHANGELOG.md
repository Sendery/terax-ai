# Changelog

Work landed on `qa` since `be21959` (*Add typescript 7 for better performance*).
Each entry names the commit it came from.

## Local speech output

### Added - read anything aloud, entirely on your machine

Terax can speak. Select text in a terminal or an editor and read it aloud from
the context menu, the command palette's new **Voice** group, or `Mod+Shift+R`
(`Mod+Shift+.` stops). A pill in the status bar shows the voice, the chunk
position and a stop button while audio plays.

Synthesis is local and self-contained. Rust owns a private directory under the
app's local data dir holding a `uv` binary, a Python 3.11, one virtual
environment per engine and the model weights; a standard-library Python sidecar
per engine binds `127.0.0.1:0`, requires a per-launch bearer token that never
appears in argv, and is killed when Terax exits. No shell profile, `PATH`,
`~/.cache`, system Python or system package manager is touched, and **Purge
everything** returns the machine to its prior state.

Two engines and four models are offered, installed and downloaded on demand as
cancellable background jobs with live logs: Kokoro (Spanish and English, preset
voices, ~330 MB) and Chatterbox (multilingual, Turbo and Nano, zero-shot cloning
from a short WAV sample). A voice profile pairs a model, a language, a preset or
a sample, synthesis parameters and a style definition, and each language has
exactly one default so "read this in Spanish" is deterministic. Two built-in
Kokoro profiles ship enabled, so reading aloud works as soon as the engine is
installed.

Long text is stripped of ANSI escapes and prompt noise, split into
sentence-sized chunks and played as a queue, so audio starts before the whole
text is synthesized. Nothing runs until the feature is used: no sidecar, no
poll, no mounted component.

Pi and the in-app agent reach it through eight new registry commands
(`tts.status`, `tts.start`, `tts.stop`, `tts.install`, `tts.download`,
`tts.voices`, `tts.speak`, `tts.stopSpeaking`), a `terax_speak` tool and a
bundled `terax-tts` skill that documents when to speak and how to write text for
each model. `app.snapshot` reports engine, model and speaking state, never the
text, never a token. Private terminals do not offer **Read aloud**, keeping the
boundary they already have with the AI.

User guide: [`docs/tts.md`](docs/tts.md).

## Mermaid diagrams

### Added — a Mermaid tab with source and visual editing ([`438dfb3`](https://github.com/Sendery/terax-ai/commit/438dfb3), merged in [`b216f42`](https://github.com/Sendery/terax-ai/commit/b216f42))

A `mermaid` tab kind: a split source editor and live diagram preview, with a
**Source** mode that accepts every Mermaid format and a structured **Visual**
mode for flowcharts and sequence diagrams.

Mermaid source stays the canonical representation. A conservative parser admits
only a documented subset, and no visual mutation reaches the tab until the real
Mermaid runtime accepts the regenerated source, so an unsupported, malformed or
stale source can never be overwritten. Flowchart node coordinates have no
Mermaid representation, so they live as bounded, defensively hydrated private
per-tab metadata, serialized with the space and omitted from `app.snapshot`.

Pointer drag works on the node body and every drag has a keyboard equivalent;
sequence participants and messages reorder through drag handles and explicit
move buttons. Selecting Mermaid code anywhere in Terax offers **Open Mermaid**
in the selection popup.

Two defects were found and fixed while building it:

- Mermaid only accepts `participant` and `actor` as sequence declaration
  keywords. The other six participant kinds were emitting source the real parser
  rejects; they now serialize as `participant Id@{ "type": ... }` shape metadata.
- The whole pane scrolled instead of the inspector, taking the Source/Visual
  toggle out of reach.

User guide: [`docs/mermaid-diagrams.md`](docs/mermaid-diagrams.md).

## Pi bridge

### Fixed — requests that follow a mutating command went unanswered ([`15a4705`](https://github.com/Sendery/terax-ai/commit/15a4705), merged in [`3a8159b`](https://github.com/Sendery/terax-ai/commit/3a8159b))

Two defects made write-then-read — the sequence an agent uses constantly —
unusable, while every command passed in isolation.

The bridge listener was re-subscribed whenever App rebuilt its handler object,
which is on almost every state change. Tauri's `listen` registers
asynchronously, so a request arriving between teardown and re-registration was
dropped and the caller waited out its 5 second frame timeout.

The scheduled-task handlers read `tasks` through a ref assigned during render,
so a command issued before React re-rendered saw the previous list: `tasks.add`
returned an id that `tasks.update` then rejected as unknown.

Also added a parity test over the three hand-maintained command allowlists — the
frontend registry, the extension package and the Rust bridge — since nothing
previously stopped them from drifting.

### Added — the last surfaces Pi could not reach ([`59a39e3`](https://github.com/Sendery/terax-ai/commit/59a39e3), merged in [`2bd1c71`](https://github.com/Sendery/terax-ai/commit/2bd1c71))

Five commands, taking the bridge from 47 to 52:

| Command | What it does |
| --- | --- |
| `git.history.open` | Opens the commit graph for a repository |
| `git.commitFile.open` | Opens a file's diff as it was at one commit |
| `search.content` | Ripgrep search under a root, returning hits |
| `tab.move` | Reorders a tab inside its own space |
| `tab.setPinned` | Pins an editor tab or returns it to the preview slot |

`git.commitFile.open` requires a 7 to 40 character hexadecimal sha: it reaches
git as an argument, so a revision expression is never resolved on the caller's
behalf. `search.content` opens nothing; its root and every hit pass the same
read deny-list the in-app AI tools use, so a match cannot reveal a path the
agent may not read.

Every non-AI tab kind is now reachable from Pi: editor, markdown, preview,
mermaid, git-diff, git-history and git-commit-file. Terminal creation remains
unexposed.

## Session history panel

### Fixed — the panel blanked when you looked at anything else ([`19c64b9`](https://github.com/Sendery/terax-ai/commit/19c64b9), merged in [`d061cac`](https://github.com/Sendery/terax-ai/commit/d061cac))

The panel resolved its transcript from the active tab's cwd, which is null for
every tab that is not a terminal. Opening a file, a diagram or a diff blanked it
mid-read. The binding now follows the focused terminal and is held until that
terminal closes.

### Added — inspect the session of any open terminal ([`19c64b9`](https://github.com/Sendery/terax-ai/commit/19c64b9))

Resolving a transcript from a directory is a heuristic: two agents of the same
kind in one directory are indistinguishable, and a session belonging to an
unfocused terminal was unreachable. Every open terminal pane is now probed, and
a picker in the panel header lists their transcripts grouped by terminal, with
the focused one marked. Choosing one pins the panel to it across focus changes.

## Git history

### Fixed — branch labels and merge stats were never fetched ([`44781d5`](https://github.com/Sendery/terax-ai/commit/44781d5), merged in [`23b1091`](https://github.com/Sendery/terax-ai/commit/23b1091))

Branch, tag and remote labels were missing from the data, not the UI: the log
format carried no `%D` and nothing asked git to decorate. Decorations are now
requested with `--decorate=full`, so a local branch named `origin/x` is not read
as a remote one, and the refs are typed rather than guessed from a short name.

Every merge showed a dash instead of stats because `git log --shortstat` prints
nothing for a merge unless asked. It now diffs against the first parent, which
is what the merge brought in. A git too old for `--diff-merges` falls back
rather than failing the view.

### Added — classics the view was missing ([`44781d5`](https://github.com/Sendery/terax-ai/commit/44781d5))

- The full commit message in the detail panel, which showed only the subject.
- Relative ages in the list, with the absolute timestamp on hover.
- Search across the body and ref names as well as the subject and both sha
  lengths, so a branch or tag name finds where it points.

## Agent notifications

### Fixed — notifications said too little, and some of it was wrong ([`e6ec6d8`](https://github.com/Sendery/terax-ai/commit/e6ec6d8), merged in [`9c9a34e`](https://github.com/Sendery/terax-ai/commit/9c9a34e))

- **No text.** The hook reporting a Claude event ran a fixed `printf` and never
  read the JSON Claude writes to its stdin, where `message` is the only field
  that says why the agent stopped. It is now extracted and carried on the OSC
  marker.
- **Every recap read as completion.** Claude's `Stop` hook fires at the end of
  every turn, so "claude finished" appeared each time it handed the turn back.
  Turn ends, the agent exiting, and being blocked on you are now three kinds,
  and the agent exiting produces a notification at all, which it never did.
- **No tab identity.** Rows and toasts now carry the tab's palette colour and
  the label the tab bar shows, rather than the raw title, which for a terminal
  stays "shell" while the bar shows the cwd or a custom name.
- **An error nobody had caused.** A false hook status means "not installed yet",
  which is every fresh profile, but the panel rendered it as *Could not update
  Claude Code config* before the user had touched anything.
