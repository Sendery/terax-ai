# Reading text aloud

Terax can speak. Selected terminal or editor text is synthesized on your own
machine by a local engine, played through the app, and nothing is sent anywhere.
The feature is off until you install an engine: no process runs, no model is
loaded, and no download happens on your behalf.

Everything lives in **Settings, Voice**, next to the existing voice input block.

## Isolation

Every byte the feature writes goes into one directory inside the app's local
data dir:

```
<app local data>/tts/
  runtime/uv/        private uv binary
  runtime/python/    private Python 3.11
  runtime/cache/     package cache
  engines/<engine>/  one virtual environment per engine
  models/hf/         model weights, shared between engines
  voices/samples/    imported voice samples
  server/            the sidecar sources
  logs/              install and server logs
  tmp/               scratch space for every child process
```

No shell profile, no `PATH`, no `~/.cache`, no `~/.local`, no system Python and
no system package manager is touched. **Purge everything** in the Storage card
deletes that directory and returns the machine to its prior state. **Reveal
folder** opens it in your file manager.

## Engines and models

An **engine** is a private Python environment and one sidecar process. A
**model** is a set of weights an engine loads. Both lists are closed: adding one
is a code change.

| Engine | Size on disk | Notes |
| --- | --- | --- |
| Kokoro | ~700 MB installed | Fast on CPU. Spanish and English. Preset voices. |
| Chatterbox | ~2.5 GB installed | Zero-shot voice cloning from a short sample. Uses `mps` on Apple silicon when it can, `cpu` otherwise. |

| Model | Engine | Languages | Voices | Expressiveness | Weights |
| --- | --- | --- | --- | --- | --- |
| `kokoro-82m` | Kokoro | Spanish, English | presets, and comma blends of presets | speed | ~330 MB |
| `chatterbox-multilingual` | Chatterbox | Spanish, English | cloned from your sample | exaggeration, guidance, temperature | ~3.2 GB |
| `chatterbox-turbo` | Chatterbox | English only | cloned from your sample | the same three, plus 19 paralinguistic tags | ~4.0 GB |
| `chatterbox-nano` | Chatterbox | English only | cloned from your sample | same as Turbo | ~3.0 GB |

Install order in the Voice tab: the Runtime card first (it happens
automatically with the first engine), then **Install** on an engine card, then
**Download** on the model you want. Each step runs as a cancellable background
job with a live log; a failed install leaves no half-registered engine.
**Start** and **Stop** on an engine card control the sidecar, and the Idle stop
setting shuts it down after a few quiet minutes so an installed engine costs no
memory when you are not using it.

The Models card also lists any other weights it finds in the shared cache, so
you can purge them one by one.

## Voices

A voice profile is a name, a model, a language (`es-ES` or `en-US`), a voice
source, synthesis parameters and a style definition. Kokoro profiles pick a
preset (`ef_dora`, `af_heart`, and so on, or a comma-separated blend);
Chatterbox profiles point at an imported WAV sample, which is converted to mono
24 kHz in the app before it is stored. A sample must be in the same language as
the profile: cloning does not translate.

Each language has exactly one default profile, which is what makes "read this in
Spanish" deterministic. Two built-in profiles (Dora for Spanish, Heart for
English, both Kokoro presets) are there before you configure anything. The
**Preview** button in the voice editor speaks one short line so you can hear a
change before saving it.

The style block holds a persona, free-form instructions and tags. It is a
description of how the voice should sound, used when an agent writes text for
that voice; it is not sent to the engine as a prompt.

## Reading something aloud

| Surface | How |
| --- | --- |
| Terminal | Select text, right-click, **Read aloud**: default voice, a language, or one specific profile. **Stop reading** is in the same menu while audio plays. |
| Editor | Same shortcut and palette entries; the selection comes from the focused editor. |
| Shortcut | `Mod+Shift+R` reads the current selection, `Mod+Shift+.` stops. Both only claim the key when they apply, so they never swallow a keystroke the shell wanted. |
| Command palette | The **Voice** group: read the selection, read it in Spanish, read it in English, stop reading, open voice settings. |

Long text is stripped of ANSI escapes and prompt noise, split into
sentence-sized chunks and played as a queue, so audio starts before the whole
text is synthesized. Total speech is capped at 8192 characters; the rest is
dropped and the result says so. The status bar shows a pill while it speaks,
with the voice name, the chunk position and a stop button, and a compact
"TTS ready" pill while an engine is loaded and idle.

Private terminals do not offer **Read aloud**. They are hidden from the AI and
from snapshots, and speech keeps the same boundary.

## Pi and the AI agent

Pi reaches the feature through the command registry:

| Command | Payload | Returns |
| --- | --- | --- |
| `tts.status` | none | runtime, engines, models, jobs, disk usage, and what is being spoken. Never a sidecar token. |
| `tts.start` | `engine` | `{ engine, starting: true }` |
| `tts.stop` | `engine?` | `{ stopped: [...] }` |
| `tts.install` | `engine` | `{ jobId }` |
| `tts.download` | `model` | `{ jobId }` |
| `tts.voices` | none | the profile list with the per-language default marked |
| `tts.speak` | `text`, `voiceId?`, `language?` | `{ voiceId, chunks, truncated, started: true }` |
| `tts.stopSpeaking` | none | `{ stopped }` |

The `@crynta/pi-terax` extension also exposes `terax_speak` as a shortcut for
`tts.speak`, and bundles the `terax-tts` skill, which documents when to speak,
how to pick a voice, and how to write text for each model (Chatterbox
paralinguistic tags, Kokoro pacing). See
[`docs/pi-terax.md`](pi-terax.md#ttsspeak).

Starting an engine and synthesizing the first chunk both take longer than the
bridge's response window, so `tts.start` and `tts.speak` return as soon as the
work is accepted and progress shows up in `tts.status`.

`app.snapshot` reports which engines are installed and running, which models are
downloaded, and whether the window is speaking. It never carries the text being
read, a token, or a sample path.

## Removing everything

- **Stop** an engine to free its memory, or let Idle stop do it.
- **Remove** on an engine card deletes its virtual environment.
- Purge a single model from the Models card, or an unknown cache entry.
- **Purge everything** in the Storage card stops every sidecar and deletes the
  whole directory, including the private Python. Voice profiles live in their
  own settings store (`terax-tts-voices.json`) and survive a purge, so
  reinstalling brings your voices back; imported samples do not, since they
  lived in the purged folder.
