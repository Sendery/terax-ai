# Dictation

Dictation turns speech into text in the AI chat. Press the microphone in the
chat box, speak, and press it again: the text lands in the box, ready to edit
or send.

## Providers

Settings, Dictation, Models, "Who transcribes" picks one:

| Provider | Where the audio goes | Needs |
|----------|----------------------|-------|
| Terax, on this machine | Nowhere. A model Terax installs transcribes it locally. | The Light model installed |
| OpenAI Whisper | OpenAI | An OpenAI API key |
| Groq Whisper | Groq | A Groq API key |
| Whisper.cpp | A Whisper.cpp server you run on `127.0.0.1` | The server running |

## Tiers for the local engine

The local engine comes in memory tiers, so it can fit the machine:

| Tier | Recogniser | Clean-up | Memory | State |
|------|------------|----------|--------|-------|
| Light | Rumble-2-Flash, 0.5B, bf16 (fp32 on CPU) | Rules: fillers, repeats, dictionary, style | About 1 GB of weights | Available |
| Medium | Qwen3-ASR-1.7B, bf16 | A small language model that rewrites what you meant | About 4 to 5 GB | Planned |
| High | Qwen3-ASR-1.7B, bf16 | A larger language model, longer context | 6 to 12 GB | Planned |

The Light weights are not quantized. Rumble-2-Flash understands 45 languages,
drops fillers such as "eh", writes numbers as digits and returns nothing for
silence instead of inventing text.

Install puts about 1.8 GB on disk: PyTorch and transformers in a private
Python environment, plus the model. It uses the same runtime and folder as the
reading voices (Settings, Voice). Terax picks the device from the machine:
the Apple GPU on Apple Silicon, CUDA with an NVIDIA card, otherwise the CPU.
You can override it under Device.

The engine starts with the first dictation and runs a self-test (one second of
silence must stay silent). It stops after the idle minutes set in Settings,
Voice, Advanced, and the next dictation starts it again.

## Cleaning the microphone

**Clean the microphone** (Settings, Dictation, Style) runs each segment through
the Voice Isolator before it is transcribed, removing noise and background.
Install the isolator in Settings, Voice, Advanced first; its card shows how
long cleaning takes on this machine. On a GPU it adds about a third of the
segment's length; on a CPU it is far slower than real time, which the card
warns about but does not prevent. Until the isolator is installed, segments
are transcribed as recorded. See [tts.md](tts.md#audio-cleanup).

## Live segments

With live segments on (the default), Terax transcribes while you speak: a
pause of 0.6 seconds after at least 2 seconds of speech sends that part to the
engine. When you stop, only the last phrase is left, so the text appears
almost at once. With it off, the whole recording is sent when you stop.

## Language and style

- **Language**: Automatic detects it for every segment. Fix it to one of the
  six app languages when very short phrases come out in the wrong one.
- **Writing style**:
  - Minimal: drops fillers only.
  - Prompt (default): no fillers, repeated words collapsed, numbers as digits.
  - Casual: like Prompt, starting in lower case and without a final period.
  - Formal: like Prompt, every sentence capitalised and closed.

Self-corrections ("de arquitectura, perdón, de requisitos") stay as spoken in
the Light tier. Rewriting them is the job of the Medium tier's language model.

## Dictionary

Add names, products and jargon under Dictionary. Each term has:

- **Write it as**: how it must appear, for example `Pi-Terax`.
- **Heard as** (optional): how the transcript spells it when it gets it wrong,
  for example `piterax`.

The local engine receives the written terms as context, which makes it more
likely to hear them right. After transcription, every "heard as" form and
every term written with other casing or accents is replaced by the written
form. Matching ignores case and accents and only replaces whole words. The
engine receives the terms that fit in 2000 characters; corrections apply to
all of them.

A one-word term of six or more letters is also restored when the engine writes
it capitalised and one letter off ("Senderi" becomes "Sendery"). Lower-case
words are never touched this way, so everyday words that happen to look like a
term stay as they are.

Import a text file with one term per line and `heard -> written` for
corrections, or paste the list. "Copy as JSON" copies the dictionary so you can
keep it outside the Terax settings file.

## Privacy

With the local provider, audio stays on the machine: the webview posts it only
to the loopback sidecar, with a token that changes on every launch.
