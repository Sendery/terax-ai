---
name: terax-tts
description: Use when Pi should speak on the user's machine through Terax's local text-to-speech, choose a language or voice profile, format text for a specific speech model, or install, download and start a speech engine. Covers expressiveness tags, voice format definitions, timing limits and the privacy boundary.
version: 1.0.0
author: Crynta
license: Apache-2.0
metadata:
  pi:
    tags: [terax, tts, speech, voice, kokoro, chatterbox]
---

# Terax Local Speech

## Overview

Terax synthesizes speech locally: a Python sidecar per engine, loopback only, no
cloud call and no audio leaving the machine. Pi reaches it through
`terax_speak` (the short path) or `terax_call` with the `tts.*` commands (the
full surface). Nothing runs until someone installs an engine, so treat speech as
an opt-in capability and check `tts.status` before assuming it is available.

## When to Speak

Speak when the user cannot watch the screen, or asked to be told rather than
shown.

- Do speak: short confirmations ("the build passed", "tests are green, three
  files changed"), a summary the user explicitly asked to hear, a prompt for a
  decision the run is blocked on.
- Do not speak: command output, logs, diffs, stack traces, file contents, long
  explanations, anything already visible in the terminal. Reading a log aloud is
  the classic misuse: it is slow, unusable, and it burns the user's patience.
- One utterance per event. Do not narrate every step of a long task.
- Keep it under a few sentences. Text over 8192 characters is refused, and text
  over a paragraph is almost always the wrong call.
- Never speak secrets, tokens, credentials, or the contents of a private
  terminal.

## Language and Voice Selection

A voice profile is `{ id, name, model, language, voice or sample, params,
style }`. Each language has exactly one default profile, which is what makes
"read this in Spanish" deterministic.

1. Call `terax_call` with `tts.voices` to list profiles: `id`, `name`, `model`,
   `language` (`es-ES` or `en-US`), `kind` (`preset` or `clone`) and `isDefault`.
2. Pass `language` to speak with that language's default profile. Pass `voiceId`
   to pin one exact profile. `voiceId` wins when both are given.
3. Pass neither to use the user's preferred language (a setting, Spanish out of
   the box).
4. Match the language to the text, not to the conversation. Spanish text read by
   an English profile is mangled by the phonemizer.

Resolution order, so a missing profile is never silent: explicit `voiceId`, then
the default for the asked language, then the default for the preferred language,
then any profile in the asked language. When nothing resolves, `tts.speak` fails
with `command_failed` and the user has to add a profile in Settings, Voice.

## Text Formatting per Model

The model behind the profile decides how text should be written.

### Kokoro (`kokoro-82m`, both languages, preset voices)

Plain prose only. No tags, no markup, no emphasis syntax: every bracket and
asterisk is read literally or dropped. Expressiveness is limited to the `speed`
parameter (0.5 to 2.0) stored on the profile, so pacing is a profile setting,
not something to encode in the text. Preset voices are `ef_dora`, `em_alex`,
`em_santa` for Spanish and `af_heart`, `af_bella`, `am_adam`, `bm_george` and
friends for English; profiles can also blend presets with a comma.

Write numbers, units and abbreviations the way they should sound: "twelve files"
reads better than "12 files" in Spanish, and "PR ciento veinte" beats "PR #120".

### Chatterbox Multilingual (`chatterbox-multilingual`, cloned voices)

Plain prose as well, with three profile parameters: `exaggeration` (0 to 2, how
hard the delivery pushes), `cfgWeight` (0 to 1, higher stays closer to the
sample) and `temperature` (0.05 to 2, variation between takes). The cloned
sample's language must match the profile's language; a Spanish sentence read
from an English sample produces an accent artifact, not a translation.

### Chatterbox Turbo and Nano (`chatterbox-turbo`, `chatterbox-nano`)

English only. Both refuse `es-ES`. They accept 19 paralinguistic tags inline:

```
[advertisement] [angry] [chuckle] [clear throat] [cough] [crying] [dramatic]
[fear] [gasp] [groan] [happy] [laugh] [narration] [sarcastic] [shush] [sigh]
[sniff] [surprised] [whispering]
```

Only `[laugh]`, `[cough]` and `[chuckle]` are documented by the model's README.
The other sixteen exist in the tokenizer and their quality is not guaranteed:
use them only when the user asked for that effect, and drop them if the result
is off.

Rules for tags: at most one tag per clause, placed immediately before the words
it colors, and used sparingly. Stacked tags degrade the whole utterance. Never
put a tag in text sent to Kokoro or Chatterbox Multilingual, where it is read
out as literal words.

## Voice Format Definitions

A profile carries a `style` object with `persona`, `instructions` and `tags`.
These are voice format definitions written by the user, not model prompts: they
describe how that voice is meant to sound and how text for it should be written
(for example "narrator, calm, no exclamations" or "uses [sigh] before bad
news"). When a profile carries them, write the text to match. They never reach
the engine as a prompt, so they only take effect through the text Pi produces.

## Limits and Timing

- 8192 characters per call, counted after trimming. Longer text is refused by
  the registry, and the chunker also caps total speech at the same budget.
- Text is split into sentence-sized chunks and played as a queue, so audio
  starts before the whole text is synthesized. ANSI escapes and prompt noise are
  stripped first, which is why a raw terminal selection is acceptable input.
- The Pi bridge waits 15 seconds for the UI to answer. Starting an engine and
  loading a model take longer, so `tts.start` returns `{ starting: true }` and
  `tts.speak` returns `{ started: true, chunks, voiceId, truncated }` as soon as
  the queue is running, not when the audio ends.
- To follow playback, poll `tts.status` and read `speech`:
  `{ speaking, voiceId, progress: { index, total }, error }`. Poll at a human
  interval (a second or more), and stop polling once `speaking` is false.
- `tts.stopSpeaking` silences the queue and keeps the engine loaded.
  `tts.stop` shuts the sidecar down and frees its memory.

## Install and Start Flow

1. `tts.status`: read `runtime.installed`, each engine's `installed` and
   `running`, and each model's `downloaded`. Everything false means the user has
   never used the feature.
2. `tts.install` with an engine: creates the private Python runtime when it is
   missing, then the engine's virtual environment. Returns `{ jobId }`; progress
   and the exit code show up in `tts.status.jobs`. This downloads hundreds of
   megabytes, so ask the user before starting it.
3. `tts.download` with a model: fetches the weights (roughly 330 MB for
   `kokoro-82m`, 3 to 4 GB for the Chatterbox models). The engine must already
   be installed. Returns `{ jobId }`.
4. `tts.start` with an engine: brings the sidecar up on the configured device.
   Optional: `tts.speak` starts the engine on demand.
5. On failure, read `speech.error` from `tts.status` and report it to the user
   instead of retrying blindly. A failed install leaves no half-registered
   engine.

Never install or download without the user's explicit agreement, and never
suggest installing a system package manager, a system Python, or anything
outside Terax's private directory.

## Privacy

- Private terminals are hidden from the AI and from snapshots, and their text is
  not offered for speech. Do not try to route it through `tts.speak`.
- `app.snapshot` reports `tts` as coordination state only: which engines are
  installed and running, which models are downloaded, and whether the window is
  speaking. It never carries the text being read, a sidecar token, or a voice
  sample path.
- `tts.status` never returns the sidecar bearer token.
- Nothing spoken is written to disk beyond the engine's own cache, and no audio
  is sent anywhere off the machine.
