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
| Pocket TTS | ~800 MB installed | Kyutai's 100M model. CPU only, many times faster than real time. Spanish and English presets. |
| OmniVoice | ~1.6 GB installed | k2-fsa's diffusion model. Clones a sample, designs a voice from attributes, or picks one itself. |
| ZONOS3-Mini | ~1.8 GB installed | Zyphra's model through its MLX server. Apple Silicon only. 44.1 kHz, default voices and cloning. |

| Model | Engine | Languages | Voices | Expressiveness | Weights |
| --- | --- | --- | --- | --- | --- |
| `kokoro-82m` | Kokoro | Spanish, English | presets, and comma blends of presets | speed | ~330 MB |
| `chatterbox-multilingual` | Chatterbox | Spanish, English | cloned from your sample | exaggeration, guidance, temperature | ~3.2 GB |
| `chatterbox-turbo` | Chatterbox | English only | cloned from your sample | the same three, plus 19 paralinguistic tags | ~4.0 GB |
| `chatterbox-nano` | Chatterbox | English only | cloned from your sample | same as Turbo | ~3.0 GB |
| `pocket-tts` | Pocket TTS | Spanish, English | presets (Lola, Alba and 23 more) | none | ~480 MB |
| `omnivoice` | OmniVoice | Spanish, English | automatic, designed, or cloned from your sample | speed, diffusion steps | ~3.3 GB |
| `zonos3-mini` | ZONOS3-Mini | Spanish, English | 12 default voices, or cloned from your sample | temperature | ~1.2 GB |

### Tuned to the machine

Terax reads the machine once (the chip, its performance cores, the memory and
any NVIDIA GPU) and gives every engine a plan. The plan decides what the
**Automatic** device means, the precision, the CPU threads, int8 quantization,
the diffusion steps, and which PyTorch build an install pulls. Each engine card
shows its plan under "Tuned for", with the reason for each choice. Choosing a
device by hand still wins over the plan.

| Engine | Apple Silicon | NVIDIA GPU | Other CPUs |
| --- | --- | --- | --- |
| Kokoro, Chatterbox | Apple GPU (MPS) | CUDA | CPU, one thread per physical core (up to 8) |
| Pocket TTS | CPU, 2 threads, no quantization | CUDA, about 2.6 times its CPU | CPU, up to 4 threads, int8 on x86 |
| OmniVoice | MPS in float32, 16 steps; the audio tokenizer stays on the CPU | CUDA in float16, 32 steps | CPU in float32, 16 steps (slow) |
| ZONOS3-Mini | MLX on the GPU, quantized backbone | not offered | not offered |

The Pocket TTS row was measured on an M4 Pro: 11.8 times real time on one
thread, 13.2 on two, no better on four; int8 measured 11.4 to 12.4, so it stays
off on the Mac. The whole sidecar, from the HTTP request to the WAV, answered a
second Spanish sentence in 0.27 s for 3.8 s of audio.

On Linux and Windows, an install passes `--torch-backend` to uv: `cpu` when
there is no NVIDIA GPU, which keeps several gigabytes of CUDA wheels off the
disk, and `auto` when there is one, so the wheels match the driver. macOS
wheels already carry MPS.

Notes per engine:

- **Pocket TTS** downloads the model for each language and the state of each
  preset voice it offers. Cloning from a sample is not offered: Kyutai keeps
  those weights behind a Hugging Face login.
- **OmniVoice** installs without the Gradio demo and training packages its
  package lists as dependencies (`excludes-omnivoice.txt`): 46 packages instead
  of 91. Cloning needs the sample's transcript, so the first use of a sample
  transcribes it with Whisper (a 1.6 GB download on that first use) and saves
  the resulting voice prompt in the private temporary folder; every later
  sentence reuses it. Voice design was trained on English and Chinese only, so
  the Spanish designed voices are the less predictable ones.
- **ZONOS3-Mini** installs Zyphra's packages from one pinned commit of their
  repository (Python 3.12, and `git` on PATH, as Chatterbox needs). The
  download takes only what reading needs: the quantized backbone, the compact
  decoder, the speaker encoder, the steering bundle and the default voices
  (about 1.2 GB). The raw-reference encoders (5.5 GB) are left out, so a sample
  is cloned through its speaker embedding. The MLX server runs inside the
  sidecar process, on a loopback port, so it stops with the sidecar. On other
  machines the engine card says why it is not offered: Zyphra's CUDA and ggml
  servers need a build toolchain Terax does not install.

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
| Terminal, editor, Markdown | Select text, right-click, **Speak**: default voice, a language, or one specific profile. **Stop** is in the same menu while anything plays, Speak or the Reader. The same menu offers the Reader's Read here and Read in new tab. |
| Selection popup | **Speak** beside Ask Terax, Read here and Read in new tab. |
| Shortcut | `Mod+Shift+R` speaks the current selection, or says why it cannot (nothing selected, a private terminal). `Mod+Shift+.` stops whatever is sounding and only claims the key while something is. |
| Command palette | The **Voice** group: Speak selection, in Spanish, in English, Stop, open voice settings. |

Long text is stripped of ANSI escapes and prompt noise, split into
sentence-sized chunks and played as a queue, so audio starts before the whole
text is synthesized. Total speech is capped at 8192 characters; the rest is
dropped, the result says so, and a "Read up to 8 KB" notice tells you when it
happened from a menu or a shortcut. The status bar shows a pill while it speaks,
with the voice name, the chunk position and a stop button, and a compact
"TTS ready" pill while an engine is loaded and idle.

Private terminals do not offer **Speak**. They are hidden from the AI and from
snapshots, and speech keeps the same boundary: the shortcut and the palette say
so instead of reading.

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
