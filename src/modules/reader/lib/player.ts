import { usePreferencesStore } from "@/modules/settings/preferences";
import { cleanClip, reportOnce } from "@/modules/isolator/lib/cleanup";
import { toast } from "sonner";
import {
  synthesize,
  TtsClientError,
  type TtsEndpoint,
} from "@/modules/tts/lib/client";
import { MODEL_VOICE_SOURCE } from "@/modules/tts/lib/engines";
import {
  armIdleTimer,
  clearIdleTimer,
  resolveEndpoint,
  resolveSamplePath,
  stopSpeaking,
} from "@/modules/tts/lib/useSpeaker";
import {
  isProfileSpeakable,
  resolveVoice,
  type VoiceProfile,
} from "@/modules/tts/lib/voices";
import { useTtsStore } from "@/modules/tts/store/ttsStore";
import {
  IDLE_PLAYBACK,
  useReaderStore,
  type DocEntry,
  type ExportOutcome,
  type PlaybackPhase,
} from "@/modules/reader/store/readerStore";
import { isSilentSegment, parseDocument, type ReaderSegment } from "./document";
import {
  type ExportSplit,
  exportPlan,
  firstAudible,
  fragmentPlan,
  stepInto,
  stepSegment,
} from "./flow";
import {
  allCuts,
  buildManifest,
  clampSpeed,
  guessLanguage,
  labelAt,
  parseManifest,
  pausesBySegment,
  stopsBySegment,
  toggleCut,
  userBreaks,
  voiceKeyOf,
  type CutKind,
  type ReaderOrigin,
  type ReaderState,
} from "./manifest";
import {
  readerNative,
  wavDurationMs,
  type ExportResult,
  type PartsResult,
  type StoredDocument,
} from "./native";
import {
  buildTimeline,
  estimateWordTimings,
  locate,
  segmentWords,
  wordAtTime,
  wordStartMs,
  type WordTiming,
} from "./timing";

/**
 * The Reader's player. One document plays at a time, through its own audio
 * element, and it never overlaps the "read aloud" speaker: each one silences
 * the other.
 *
 * Audio comes from the document's folder when a clip was made before, and
 * from the speech engine otherwise, so a document already listened to plays
 * again with the engine stopped.
 */

/** Clips kept as object URLs around the one playing. */
const URL_WINDOW = 12;
/** Clips synthesized ahead of the one playing. */
const PREFETCH = 2;
const SAVE_DEBOUNCE_MS = 1500;
/** While playing, the manifest is rewritten when new clips were measured... */
const SAVE_WHILE_PLAYING_MS = 5000;
/** ...and at least this often for the position alone. */
const SAVE_POSITION_MS = 30_000;

type Clip = {
  docId: string;
  segment: number;
  /** Last word of the clip: survives a re-segmentation that renumbers it. */
  lastWord: number;
  timings: WordTiming[];
};

type VoiceContext = {
  docId: string;
  voice: VoiceProfile;
  voiceKey: string;
  endpoint: TtsEndpoint | null;
  samplePath: string | null;
  /** Clips go through the voice isolator before they are cached and played. */
  isolated: boolean;
};

let audio: HTMLAudioElement | null = null;
/** Bumped by every user action, so stale async work drops itself. */
let generation = 0;
let clip: Clip | null = null;
let frame = 0;
let gapTimer: ReturnType<typeof setTimeout> | null = null;
let voiceContext: VoiceContext | null = null;
/** Object URLs by `docId/voiceKey/segmentKey`, so a clip made with one voice is never played for another. */
const urls = new Map<string, string>();
const pending = new Map<string, Promise<ArrayBuffer>>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let lastPeriodicSave = 0;
/** Clip lengths learned since the last save, per document. */
const unsavedDurations = new Set<string>();
let speakerWatch: (() => void) | null = null;

function store() {
  return useReaderStore.getState();
}

function entryOf(docId: string): DocEntry | null {
  return store().docs[docId] ?? null;
}

/** The document is sounding, or about to: playing, loading a clip or in a scripted gap. */
export function isLive(docId: string): boolean {
  const { playback } = store();
  return (
    playback.docId === docId &&
    (playback.phase === "playing" ||
      playback.phase === "loading" ||
      playback.phase === "gap")
  );
}

function setPhase(
  phase: PlaybackPhase,
  patch: Partial<typeof IDLE_PLAYBACK> = {},
) {
  store().setPlayback({ phase, ...patch });
}

function messageOf(err: unknown): string {
  if (err instanceof TtsClientError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Documents

function indexDurations(
  entry: Pick<DocEntry, "doc" | "durations">,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const segment of entry.doc.segments) {
    const ms = entry.durations.get(segment.key);
    if (ms !== undefined) out.set(segment.index, ms);
  }
  return out;
}

function withTimeline(entry: Omit<DocEntry, "timeline">): DocEntry {
  const cuts = allCuts(entry.doc, entry.state.cutPoints);
  return {
    ...entry,
    timeline: buildTimeline(
      entry.doc,
      indexDurations(entry),
      pausesBySegment(entry.doc, cuts),
    ),
  };
}

/** Durations the manifest recorded, if they were made with `voiceKey`. */
function manifestDurations(
  raw: string | null,
  voiceKey: string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw || !voiceKey) return out;
  try {
    const json = JSON.parse(raw) as { voice_key?: unknown; segments?: unknown };
    if (json.voice_key !== voiceKey || !Array.isArray(json.segments))
      return out;
    for (const s of json.segments as unknown[]) {
      if (typeof s !== "object" || s === null) continue;
      const { key, start_ms, end_ms } = s as Record<string, unknown>;
      if (
        typeof key !== "string" ||
        typeof start_ms !== "number" ||
        typeof end_ms !== "number"
      ) {
        continue;
      }
      if (end_ms >= start_ms) out.set(key, end_ms - start_ms);
    }
  } catch {
    // An unreadable manifest only costs re-measuring the clips.
  }
  return out;
}

function manifestVoiceKey(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const key = (JSON.parse(raw) as { voice_key?: unknown }).voice_key;
    return typeof key === "string" && /^[0-9a-z_-]{1,64}$/.test(key)
      ? key
      : null;
  } catch {
    return null;
  }
}

/** Puts a stored document in the store, ready to render and play. */
export function adoptDocument(
  stored: StoredDocument,
  fallbackTitle?: string,
): DocEntry {
  const existing = entryOf(stored.id);
  if (existing) return existing;
  const probe = parseDocument(stored.source);
  const title = stored.title ?? fallbackTitle ?? "Untitled";
  const state = parseManifest(
    stored.manifest,
    probe.words.length,
    title,
    stored.sourcePath,
  );
  if (stored.title && !stored.manifest) state.title = stored.title;
  const doc = parseDocument(stored.source, userBreaks(state.cutPoints));
  const voiceKey = manifestVoiceKey(stored.manifest);
  const entry = withTimeline({
    id: stored.id,
    source: stored.source,
    doc,
    state,
    language: guessLanguage(doc, usePreferencesStore.getState().ttsLanguages),
    voiceKey,
    durations: manifestDurations(stored.manifest, voiceKey),
    cached: new Set(),
  });
  store().putDoc(entry);
  // A first open writes the manifest at once, so the library lists the
  // document with its title and size before anything else changes.
  if (!stored.manifest) scheduleSave(entry.id, 0);
  return entry;
}

export async function openStored(args: {
  text?: string;
  path?: string;
  title?: string;
}): Promise<DocEntry> {
  const stored = await readerNative.open(args);
  return adoptDocument(stored, args.title);
}

export async function loadStored(id: string): Promise<DocEntry> {
  const existing = entryOf(id);
  if (existing) return existing;
  return adoptDocument(await readerNative.load(id));
}

function updateState(
  docId: string,
  update: (state: ReaderState) => ReaderState,
): DocEntry | null {
  const entry = entryOf(docId);
  if (!entry) return null;
  const state = update(entry.state);
  const breaksChanged =
    userBreaks(state.cutPoints).join(",") !==
    userBreaks(entry.state.cutPoints).join(",");
  const doc = breaksChanged
    ? parseDocument(entry.source, userBreaks(state.cutPoints))
    : entry.doc;
  const next = withTimeline({ ...entry, state, doc });
  store().putDoc(next);
  if (breaksChanged) remapPlayback(next);
  scheduleSave(docId, 200);
  return next;
}

/** After a re-segmentation, the playing word keeps its place. */
function remapPlayback(entry: DocEntry): void {
  const { playback } = store();
  if (playback.docId !== entry.id) return;
  const word = entry.doc.words[playback.wordIndex];
  if (word) store().setPlayback({ segment: word.segment });
  if (clip && clip.docId === entry.id) {
    const last = entry.doc.words[clip.lastWord];
    if (last) clip = { ...clip, segment: last.segment };
  }
}

// ---------------------------------------------------------------------------
// Saving

function snapshotState(entry: DocEntry): ReaderState {
  const { playback } = store();
  if (playback.docId !== entry.id) return entry.state;
  const status =
    playback.phase === "finished"
      ? "finished"
      : playback.phase === "idle"
        ? entry.state.status
        : playback.phase === "playing" ||
            playback.phase === "gap" ||
            playback.phase === "loading"
          ? "playing"
          : "paused";
  return {
    ...entry.state,
    status,
    lastWordIndex: playback.wordIndex,
    lastPositionMs: playback.positionMs,
  };
}

export async function saveNow(docId: string): Promise<void> {
  const timer = saveTimers.get(docId);
  if (timer) clearTimeout(timer);
  saveTimers.delete(docId);
  const entry = entryOf(docId);
  if (!entry) return;
  const state = snapshotState(entry);
  if (state !== entry.state) store().patchDoc(docId, { state });
  unsavedDurations.delete(docId);
  const manifest = buildManifest({
    id: entry.id,
    doc: entry.doc,
    state,
    language: entry.language,
    voiceKey: entry.voiceKey,
    durations: indexDurations(entry),
    timeline: entry.timeline,
  });
  try {
    await readerNative.saveManifest(docId, JSON.stringify(manifest));
  } catch (err) {
    console.warn("reader.save", err);
  }
}

function scheduleSave(docId: string, delay = SAVE_DEBOUNCE_MS): void {
  const existing = saveTimers.get(docId);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    docId,
    setTimeout(() => {
      void saveNow(docId);
    }, delay),
  );
}

// ---------------------------------------------------------------------------
// Voice and audio

async function voiceFor(entry: DocEntry): Promise<VoiceProfile> {
  const tts = useTtsStore.getState();
  await tts.hydrate();
  const { profiles, defaults } = useTtsStore.getState();
  const { ttsDefaultLanguage } = usePreferencesStore.getState();
  const voice = resolveVoice(
    profiles,
    defaults,
    { ttsDefaultLanguage },
    { voiceId: entry.state.voiceId, language: entry.language },
  );
  if (!voice)
    throw new Error(
      "No voice profile is configured. Add one in Settings, Voice.",
    );
  if (!isProfileSpeakable(voice)) {
    throw new Error(
      `The voice "${voice.name}" still needs ${
        MODEL_VOICE_SOURCE[voice.model] === "preset"
          ? "a preset"
          : "a voice sample"
      }.`,
    );
  }
  return voice;
}

/** Binds the document to a voice: its cache folder, known clips and lengths. */
async function bindVoice(docId: string): Promise<VoiceContext> {
  const entry = entryOf(docId);
  if (!entry) throw new Error("This document is no longer open.");
  const voice = await voiceFor(entry);
  const isolated = usePreferencesStore.getState().cleanReadingAudio;
  const voiceKey = voiceKeyOf(voice, isolated);
  if (
    voiceContext &&
    voiceContext.docId === docId &&
    voiceContext.voiceKey === voiceKey
  ) {
    return voiceContext;
  }
  if (voiceContext?.voiceKey !== voiceKey || voiceContext?.docId !== docId)
    releaseUrls();
  const keys = [...new Set(entry.doc.segments.map((s) => s.key))];
  const present = await readerNative
    .chunksPresent(docId, voiceKey, keys)
    .catch(() => []);
  const fresh = entryOf(docId) ?? entry;
  const sameVoice = fresh.voiceKey === voiceKey;
  store().putDoc(
    withTimeline({
      ...fresh,
      voiceKey,
      cached: new Set(present),
      durations: sameVoice ? fresh.durations : new Map(),
    }),
  );
  voiceContext = {
    docId,
    voice,
    voiceKey,
    endpoint:
      voiceContext?.voice.model === voice.model ? voiceContext.endpoint : null,
    samplePath: null,
    isolated,
  };
  return voiceContext;
}

type SynthesizedClip = {
  bytes: ArrayBuffer;
  /** False when isolation was asked for but skipped: not to be cached. */
  cacheable: boolean;
};

async function synthesizeClip(
  ctx: VoiceContext,
  text: string,
): Promise<SynthesizedClip> {
  const raw = await synthesizeRaw(ctx, text);
  if (!ctx.isolated) return { bytes: raw, cacheable: true };
  const clip = await cleanClip(
    true,
    new Uint8Array(raw),
    usePreferencesStore.getState().isolatorDevice,
    (reason) => reportOnce(reason, (m) => toast.warning(m)),
  );
  return {
    bytes: clip.bytes.buffer.slice(
      clip.bytes.byteOffset,
      clip.bytes.byteOffset + clip.bytes.byteLength,
    ) as ArrayBuffer,
    cacheable: clip.cleaned,
  };
}

async function synthesizeRaw(
  ctx: VoiceContext,
  text: string,
): Promise<ArrayBuffer> {
  const attempt = async (): Promise<ArrayBuffer> => {
    if (!ctx.endpoint) {
      ctx.endpoint = await resolveEndpoint(ctx.voice);
      ctx.samplePath = await resolveSamplePath(ctx.voice);
    }
    const blob = await synthesize(ctx.endpoint, {
      model: ctx.voice.model,
      text,
      language: ctx.voice.language,
      voice: ctx.voice.voice,
      samplePath: ctx.samplePath,
      params: ctx.voice.params,
    });
    return blob.arrayBuffer();
  };
  try {
    return await attempt();
  } catch (err) {
    // A sidecar restarted since the endpoint was read answers with a new
    // port and token: look it up once more before giving up.
    if (
      err instanceof TtsClientError &&
      (err.code === "network" || err.code === "unauthorized")
    ) {
      ctx.endpoint = null;
      return attempt();
    }
    throw err;
  }
}

/** The clip's bytes: from disk when cached, else synthesized and stored. */
function clipBytes(
  ctx: VoiceContext,
  segment: ReaderSegment,
): Promise<ArrayBuffer> {
  const id = `${ctx.docId}/${ctx.voiceKey}/${segment.key}`;
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const work = (async () => {
    const entry = entryOf(ctx.docId);
    if (entry?.cached.has(segment.key)) {
      try {
        return await readerNative.chunkGet(
          ctx.docId,
          ctx.voiceKey,
          segment.key,
        );
      } catch {
        // A clip deleted behind our back is made again.
      }
    }
    const { bytes, cacheable } = await synthesizeClip(ctx, segment.text);
    if (!cacheable) return bytes;
    try {
      await readerNative.chunkPut(
        ctx.docId,
        ctx.voiceKey,
        segment.key,
        new Uint8Array(bytes),
      );
      const now = entryOf(ctx.docId);
      if (now && now.voiceKey === ctx.voiceKey) {
        store().patchDoc(ctx.docId, {
          cached: new Set([...now.cached, segment.key]),
        });
      }
    } catch (err) {
      console.warn("reader.cache", err);
    }
    return bytes;
  })();
  pending.set(id, work);
  void work.finally(() => pending.delete(id)).catch(() => {});
  return work;
}

function urlKey(ctx: VoiceContext, segment: ReaderSegment): string {
  return `${ctx.docId}/${ctx.voiceKey}/${segment.key}`;
}

/** Records a clip length, unless the document moved to another voice since. */
function recordDuration(ctx: VoiceContext, key: string, ms: number): void {
  const entry = entryOf(ctx.docId);
  if (!entry || entry.voiceKey !== ctx.voiceKey) return;
  if (entry.durations.get(key) === ms) return;
  const durations = new Map(entry.durations);
  durations.set(key, ms);
  store().putDoc(withTimeline({ ...entry, durations }));
  unsavedDurations.add(ctx.docId);
}

async function clipUrl(
  ctx: VoiceContext,
  segment: ReaderSegment,
): Promise<{ url: string; ms: number }> {
  const id = urlKey(ctx, segment);
  const known = urls.get(id);
  const knownMs = entryOf(ctx.docId)?.durations.get(segment.key);
  if (known && knownMs !== undefined) return { url: known, ms: knownMs };
  const bytes = await clipBytes(ctx, segment);
  const ms = wavDurationMs(bytes) ?? knownMs ?? 0;
  recordDuration(ctx, segment.key, ms);
  // Another call may have made the URL while this one waited for the bytes.
  const url =
    urls.get(id) ??
    URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  urls.set(id, url);
  trimUrls();
  return { url, ms };
}

function trimUrls(): void {
  if (urls.size <= URL_WINDOW) return;
  const keep = new Set<string>();
  const entry = clip ? entryOf(clip.docId) : null;
  if (entry && clip && voiceContext) {
    for (let s = clip.segment - 2; s <= clip.segment + PREFETCH + 1; s++) {
      const segment = entry.doc.segments[s];
      if (segment) keep.add(urlKey(voiceContext, segment));
    }
  }
  for (const [key, url] of urls) {
    if (urls.size <= URL_WINDOW) break;
    if (keep.has(key)) continue;
    URL.revokeObjectURL(url);
    urls.delete(key);
  }
}

function releaseUrls(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

function prefetch(ctx: VoiceContext, from: number): void {
  const entry = entryOf(ctx.docId);
  if (!entry) return;
  let queued = 0;
  for (let s = from; s < entry.doc.segments.length && queued < PREFETCH; s++) {
    const segment = entry.doc.segments[s];
    if (isSilentSegment(segment)) continue;
    queued++;
    // Prefetching all the way to an object URL lets the next sentence start
    // without a "loading" flash or a second read from disk.
    void clipUrl(ctx, segment).catch(() => {});
  }
}

function element(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.onended = () => {
    const current = clip;
    if (!current) return;
    if (store().playback.phase !== "playing") return;
    const entry = entryOf(current.docId);
    if (!entry) return;
    const lastWord = entry.doc.words[current.lastWord];
    const next = (lastWord?.segment ?? current.segment) + 1;
    void advance(generation, current.docId, next);
  };
  audio.onerror = () => {
    if (!clip || !audio?.currentSrc) return;
    stopTracking();
    setPhase("paused", {
      error: "The audio device rejected the generated speech.",
    });
  };
  return audio;
}

function detachAudio(): void {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

// ---------------------------------------------------------------------------
// Word tracking

function stopTracking(): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

function track(): void {
  stopTracking();
  const tick = () => {
    frame = 0;
    const el = audio;
    const current = clip;
    if (!el || !current || el.paused) return;
    const entry = entryOf(current.docId);
    if (!entry) return;
    const ms = el.currentTime * 1000;
    const word = wordAtTime(current.timings, ms);
    const start = entry.timeline.starts[current.segment] ?? 0;
    const { playback } = store();
    if (word !== null && word !== playback.wordIndex) {
      store().setPlayback({
        wordIndex: word,
        segment: current.segment,
        positionMs: start + ms,
      });
      const now = Date.now();
      const since = now - lastPeriodicSave;
      if (
        (unsavedDurations.has(current.docId) &&
          since > SAVE_WHILE_PLAYING_MS) ||
        since > SAVE_POSITION_MS
      ) {
        lastPeriodicSave = now;
        scheduleSave(current.docId, 0);
      }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Flow

type StartAt = { wordIndex: number } | { offsetMs: number };

function speedOf(docId: string): number {
  return clampSpeed(entryOf(docId)?.state.speed ?? 1);
}

function whenMetadata(el: HTMLAudioElement): Promise<void> {
  if (el.readyState >= 1) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener("loadedmetadata", done);
      el.removeEventListener("error", done);
      resolve();
    };
    el.addEventListener("loadedmetadata", done);
    el.addEventListener("error", done);
  });
}

async function playSegment(
  my: number,
  docId: string,
  index: number,
  at: StartAt,
): Promise<void> {
  const entry = entryOf(docId);
  if (!entry) return;
  const segment = entry.doc.segments[index];
  if (!segment) return finish(docId);
  const firstWord = "wordIndex" in at ? at.wordIndex : segment.wordStart;
  store().setPlayback({
    docId,
    segment: index,
    wordIndex: firstWord,
    positionMs:
      (entry.timeline.starts[index] ?? 0) +
      ("offsetMs" in at ? at.offsetMs : 0),
    error: null,
  });
  const ctx = await bindVoice(docId);
  if (my !== generation) return;
  const ready =
    urls.has(urlKey(ctx, segment)) &&
    (entryOf(docId) ?? entry).durations.has(segment.key);
  if (!ready) setPhase("loading");
  let loaded: { url: string; ms: number };
  try {
    loaded = await clipUrl(ctx, segment);
  } catch (err) {
    if (my !== generation) return;
    stopTracking();
    setPhase("paused", { error: messageOf(err) });
    void saveNow(docId);
    return;
  }
  if (my !== generation) return;
  const fresh = entryOf(docId) ?? entry;
  const timings = estimateWordTimings(
    segmentWords(fresh.doc, segment),
    loaded.ms,
  );
  clip = { docId, segment: index, lastWord: segment.wordEnd - 1, timings };
  const el = element();
  if (!el) return;
  el.src = loaded.url;
  el.playbackRate = speedOf(docId);
  const offsetMs =
    "offsetMs" in at ? at.offsetMs : wordStartMs(timings, at.wordIndex);
  await whenMetadata(el);
  if (my !== generation) return;
  if (offsetMs > 0) el.currentTime = offsetMs / 1000;
  el.playbackRate = speedOf(docId);
  try {
    await el.play();
  } catch (err) {
    if (my !== generation) return;
    if (err instanceof DOMException && err.name === "AbortError") return;
    setPhase("paused", { error: messageOf(err) });
    return;
  }
  if (my !== generation) return;
  setPhase("playing");
  track();
  prefetch(ctx, index + 1);
}

/** Moves on to segment `next` after one finished on its own. */
async function advance(my: number, docId: string, next: number): Promise<void> {
  const entry = entryOf(docId);
  if (!entry) return;
  const cuts = allCuts(entry.doc, entry.state.cutPoints);
  const step = stepInto(
    entry.doc,
    next,
    stopsBySegment(entry.doc, cuts, entry.state.stopAtBookmarks),
    pausesBySegment(entry.doc, cuts),
  );
  stopTracking();
  if (step.type === "finish") return finish(docId);
  const segment = entry.doc.segments[step.segment];
  if (step.type === "stop") {
    detachAudio();
    clip = null;
    store().setPlayback({
      segment: step.segment,
      wordIndex: segment.wordStart,
      positionMs: entry.timeline.starts[step.segment] ?? 0,
    });
    setPhase("paused");
    armIdleTimer();
    void saveNow(docId);
    return;
  }
  if (step.type === "gap") {
    store().setPlayback({
      segment: step.segment,
      wordIndex: segment.wordStart,
      positionMs: entry.timeline.starts[step.segment] ?? 0,
    });
    setPhase("gap");
    const ctx = voiceContext;
    if (ctx) prefetch(ctx, step.segment);
    await new Promise<void>((resolve) => {
      gapTimer = setTimeout(() => {
        gapTimer = null;
        resolve();
      }, step.ms);
    });
    if (my !== generation) return;
  }
  return playSegment(my, docId, step.segment, { offsetMs: 0 });
}

function finish(docId: string): void {
  stopTracking();
  clip = null;
  detachAudio();
  const entry = entryOf(docId);
  const last = entry ? Math.max(0, entry.doc.words.length - 1) : 0;
  store().setPlayback({
    phase: "finished",
    wordIndex: last,
    positionMs: entry?.timeline.totalMs ?? 0,
  });
  armIdleTimer();
  void saveNow(docId);
}

function cancelPending(): number {
  generation += 1;
  if (gapTimer) clearTimeout(gapTimer);
  gapTimer = null;
  return generation;
}

function watchSpeaker(): void {
  if (speakerWatch) return;
  // Reading aloud elsewhere in the app takes over the speakers.
  speakerWatch = useTtsStore.subscribe((s, prev) => {
    if (s.speaking && !prev.speaking) pauseReader();
  });
}

async function takeOver(docId: string): Promise<void> {
  stopSpeaking();
  watchSpeaker();
  clearIdleTimer();
  const { playback } = store();
  if (playback.docId && playback.docId !== docId) {
    const previous = playback.docId;
    detachAudio();
    clip = null;
    stopTracking();
    await saveNow(previous);
    store().setPlayback({
      ...IDLE_PLAYBACK,
      exporting: store().playback.exporting,
    });
  }
}

// ---------------------------------------------------------------------------
// Public controls

/** Plays from a word, or from where the document was left. */
export async function playReader(
  docId: string,
  fromWord?: number,
): Promise<void> {
  const entry = entryOf(docId);
  if (!entry) throw new Error("Open the document in a Reader tab first.");
  const my = cancelPending();
  await takeOver(docId);
  if (my !== generation) return;
  const { playback } = store();
  let wordIndex = fromWord;
  if (wordIndex === undefined) {
    const finished =
      playback.docId === docId
        ? playback.phase === "finished"
        : entry.state.status === "finished";
    wordIndex = finished
      ? 0
      : playback.docId === docId
        ? playback.wordIndex
        : entry.state.lastWordIndex;
  }
  const word =
    entry.doc.words[
      Math.max(0, Math.min(wordIndex, entry.doc.words.length - 1))
    ];
  if (!word) return;
  const segment = firstAudible(entry.doc, word.segment);
  if (segment === null) return finish(docId);
  const start: StartAt =
    segment === word.segment
      ? { wordIndex: word.index }
      : { wordIndex: entry.doc.segments[segment].wordStart };
  store().setPlayback({ docId, phase: "loading", error: null });
  try {
    await playSegment(my, docId, segment, start);
  } catch (err) {
    if (my !== generation) return;
    setPhase("paused", { error: messageOf(err) });
  }
}

export function pauseReader(): boolean {
  const { playback } = store();
  if (!playback.docId) return false;
  if (playback.phase === "playing") {
    // Also drops a next clip that is about to start: without this, a pause
    // between two sentences was undone when that clip began.
    cancelPending();
    audio?.pause();
    stopTracking();
    setPhase("paused");
  } else if (playback.phase === "gap" || playback.phase === "loading") {
    cancelPending();
    detachAudio();
    clip = null;
    setPhase("paused");
  } else {
    return false;
  }
  armIdleTimer();
  void saveNow(playback.docId);
  return true;
}

export async function resumeReader(docId?: string): Promise<boolean> {
  const { playback } = store();
  const target = docId ?? playback.docId;
  if (!target) return false;
  const el = audio;
  if (
    playback.docId === target &&
    playback.phase === "paused" &&
    clip?.docId === target &&
    el?.currentSrc
  ) {
    stopSpeaking();
    clearIdleTimer();
    el.playbackRate = speedOf(target);
    try {
      await el.play();
    } catch (err) {
      setPhase("paused", { error: messageOf(err) });
      return false;
    }
    setPhase("playing", { error: null });
    track();
    return true;
  }
  await playReader(target);
  return true;
}

export async function toggleReader(docId: string): Promise<void> {
  const { playback } = store();
  const live =
    playback.docId === docId &&
    (playback.phase === "playing" ||
      playback.phase === "gap" ||
      playback.phase === "loading");
  if (live) {
    pauseReader();
    return;
  }
  await resumeReader(docId);
}

/** Stops and forgets the audio, keeping the reading position. */
export function stopReader(): void {
  const { playback } = store();
  cancelPending();
  stopTracking();
  detachAudio();
  clip = null;
  if (playback.docId) {
    const docId = playback.docId;
    const entry = entryOf(docId);
    // The position goes into the document before playback lets go of it, so
    // the idle state can be set at once: setting it after the save used to
    // clobber a play started in the meantime.
    if (entry) {
      const state = snapshotState(entry);
      store().patchDoc(docId, {
        state: {
          ...state,
          status: playback.phase === "finished" ? "finished" : "paused",
        },
      });
    }
    store().setPlayback({
      ...IDLE_PLAYBACK,
      exporting: store().playback.exporting,
    });
    void saveNow(docId);
  }
  armIdleTimer();
}

/** Previous or next sentence. Back from mid-sentence restarts it first. */
export async function stepReader(docId: string, delta: 1 | -1): Promise<void> {
  const entry = entryOf(docId);
  if (!entry) return;
  const { playback } = store();
  const here =
    playback.docId === docId
      ? playback.segment
      : (entry.doc.words[entry.state.lastWordIndex]?.segment ?? 0);
  const elapsed = audio && clip?.docId === docId ? audio.currentTime : 0;
  const target =
    delta < 0 && elapsed > 2 ? here : stepSegment(entry.doc, here, delta);
  const live =
    playback.docId === docId &&
    playback.phase !== "paused" &&
    playback.phase !== "idle" &&
    playback.phase !== "finished";
  const wordIndex = entry.doc.segments[target]?.wordStart ?? 0;
  if (live) {
    await playReader(docId, wordIndex);
  } else {
    moveCursorTo(docId, wordIndex);
  }
}

/** Jumps through document time, crossing segments when needed. */
export async function skipReader(
  docId: string,
  deltaMs: number,
): Promise<void> {
  const entry = entryOf(docId);
  if (!entry) return;
  const { playback } = store();
  const el = audio;
  const start = entry.timeline.starts[playback.segment] ?? 0;
  const now =
    playback.docId === docId &&
    playback.phase === "playing" &&
    clip?.docId === docId &&
    el
      ? start + el.currentTime * 1000
      : playback.docId === docId
        ? playback.positionMs
        : (entry.timeline.starts[
            entry.doc.words[entry.state.lastWordIndex]?.segment ?? 0
          ] ?? 0);
  await seekReaderTo(docId, now + deltaMs);
}

/** Moves to a point in document time (1x), playing from there if live. */
export async function seekReaderTo(docId: string, ms: number): Promise<void> {
  const entry = entryOf(docId);
  if (!entry) return;
  const { playback } = store();
  const el = audio;
  const target = locate(entry.timeline, ms);
  if (!target) return;
  const live = isLive(docId);
  if (
    live &&
    playback.phase === "playing" &&
    clip?.docId === docId &&
    clip.segment === target.segment &&
    el
  ) {
    el.currentTime = target.offsetMs / 1000;
    return;
  }
  if (!live) {
    const segment = entry.doc.segments[target.segment];
    moveCursorTo(docId, segment?.wordStart ?? 0);
    return;
  }
  const my = cancelPending();
  // The clip that was sounding stops now, not when the new one is ready.
  stopTracking();
  detachAudio();
  clip = null;
  const audible = firstAudible(entry.doc, target.segment);
  if (audible === null) return finish(docId);
  setPhase("loading");
  await playSegment(my, docId, audible, {
    offsetMs: audible === target.segment ? target.offsetMs : 0,
  });
}

/** Sets where playback will start without playing. */
export function moveCursorTo(docId: string, wordIndex: number): void {
  const entry = entryOf(docId);
  if (!entry) return;
  const word =
    entry.doc.words[
      Math.max(0, Math.min(wordIndex, entry.doc.words.length - 1))
    ];
  if (!word) return;
  // While it sounds, the cursor is the pane's business: playback goes on.
  if (isLive(docId)) return;
  const { playback } = store();
  if (playback.docId === docId) {
    store().setPlayback({
      segment: word.segment,
      wordIndex: word.index,
      positionMs: entry.timeline.starts[word.segment] ?? 0,
      phase: playback.phase === "finished" ? "paused" : playback.phase,
    });
    if (clip?.docId === docId) {
      detachAudio();
      clip = null;
    }
  }
  updateState(docId, (s) => ({
    ...s,
    lastWordIndex: word.index,
    status: s.status === "finished" ? "paused" : s.status,
  }));
}

export function setReaderSpeed(docId: string, speed: number): void {
  const value = clampSpeed(speed);
  updateState(docId, (s) => ({ ...s, speed: value }));
  if (clip?.docId === docId && audio) audio.playbackRate = value;
}

export async function setReaderVoice(
  docId: string,
  voiceId: string | null,
): Promise<void> {
  const wasLive = isLive(docId);
  if (wasLive) pauseReader();
  updateState(docId, (s) => ({ ...s, voiceId }));
  if (voiceContext?.docId === docId) {
    voiceContext = null;
    releaseUrls();
  }
  // A paused clip in the old voice must not be resumed as is.
  if (clip?.docId === docId) {
    detachAudio();
    clip = null;
  }
  if (wasLive) await playReader(docId, store().playback.wordIndex);
}

/** Records the tab a reading belongs to, for the library to lead back to it. */
export function setReaderOrigin(docId: string, origin: ReaderOrigin): void {
  updateState(docId, (s) => ({ ...s, origin }));
}

export function setStopAtBookmarks(docId: string, value: boolean): void {
  updateState(docId, (s) => ({ ...s, stopAtBookmarks: value }));
}

/** Adds or removes a cut at a word; returns whether it now exists. */
export function toggleReaderCut(
  docId: string,
  kind: CutKind,
  wordIndex: number,
  options: { label?: string; pauseMs?: number } = {},
): boolean {
  const entry = entryOf(docId);
  if (!entry?.doc.words[wordIndex]) return false;
  const label =
    options.label ??
    (kind === "bookmark"
      ? labelAt(entry.doc, wordIndex)
      : kind === "pause"
        ? `Pause before "${entry.doc.words[wordIndex].text}"`
        : `Stop before "${entry.doc.words[wordIndex].text}"`);
  let added = false;
  updateState(docId, (s) => {
    const cutPoints = toggleCut(
      s.cutPoints,
      kind,
      wordIndex,
      label,
      options.pauseMs,
    );
    added = cutPoints.length >= s.cutPoints.length;
    return { ...s, cutPoints };
  });
  return added;
}

export function removeReaderCut(docId: string, cutId: string): void {
  updateState(docId, (s) => ({
    ...s,
    cutPoints: s.cutPoints.filter((c) => c.id !== cutId),
  }));
}

/**
 * Synthesizes what is missing and writes the reading out: one WAV with the
 * scripted pauses (split "none"), or one WAV per section, paragraph or
 * sentence with an index and a playlist. The outcome stays in the store for
 * agents, which cannot wait on a long export through the bridge.
 */
export async function exportReader(
  docId: string,
  split: ExportSplit = "none",
): Promise<ExportResult | PartsResult> {
  const entry = entryOf(docId);
  if (!entry) throw new Error("Open the document in the Reader first.");
  if (store().playback.exporting)
    throw new Error("An export is already running.");
  const started = Date.now();
  const report = (done: number, total: number) => {
    store().setPlayback({ exporting: { docId, done, total, split } });
    store().setExport(docId, {
      status: "running",
      split,
      done,
      total,
      startedAt: started,
    });
  };
  report(0, 0);
  try {
    const ctx = await bindVoice(docId);
    const fresh = entryOf(docId) ?? entry;
    const cuts = allCuts(fresh.doc, fresh.state.cutPoints);
    const pauses = pausesBySegment(fresh.doc, cuts);
    const chapters = new Map<number, string>();
    if (split === "none") {
      for (const block of fresh.doc.blocks) {
        if (block.kind !== "heading" || block.wordEnd <= block.wordStart)
          continue;
        chapters.set(
          block.segmentStart,
          fresh.doc.words
            .slice(block.wordStart, block.wordEnd)
            .map((w) => w.text)
            .join(" "),
        );
      }
      for (const cut of cuts) {
        if (cut.kind !== "bookmark") continue;
        const segment = fresh.doc.words[cut.wordIndex]?.segment;
        if (segment !== undefined && !chapters.has(segment))
          chapters.set(segment, cut.label || "Bookmark");
      }
    }
    const plan = exportPlan(fresh.doc, pauses, chapters);
    if (plan.length === 0)
      throw new Error("This document has nothing to read aloud.");
    report(0, plan.length);
    let done = 0;
    for (const step of plan) {
      const segment = fresh.doc.segments[step.segment];
      const now = entryOf(docId);
      if (!now) throw new Error("The document was closed during the export.");
      if (!now.cached.has(segment.key)) {
        const bytes = await clipBytes(ctx, segment);
        const ms = wavDurationMs(bytes);
        if (ms !== null) recordDuration(ctx, segment.key, ms);
      }
      done++;
      report(done, plan.length);
    }
    const key = (index: number) => fresh.doc.segments[index].key;
    const result =
      split === "none"
        ? await readerNative.exportAudio(
            docId,
            ctx.voiceKey,
            plan.map((step) => ({
              key: key(step.segment),
              pauseAfterMs: step.pauseAfterMs,
              ...(step.chapter ? { chapter: step.chapter } : {}),
            })),
            fresh.state.title,
          )
        : await readerNative.exportParts(
            docId,
            ctx.voiceKey,
            fragmentPlan(fresh.doc, split, pauses).map((fragment) => ({
              title: fragment.title,
              segments: fragment.steps.map((step) => ({
                key: key(step.segment),
                pauseAfterMs: step.pauseAfterMs,
              })),
            })),
            `${fresh.state.title} (${split})`,
          );
    store().setExport(docId, {
      status: "done",
      split,
      result,
      finishedAt: Date.now(),
    });
    void saveNow(docId);
    return result;
  } catch (err) {
    store().setExport(docId, {
      status: "failed",
      split,
      error: messageOf(err),
      finishedAt: Date.now(),
    });
    throw err;
  } finally {
    store().setPlayback({ exporting: null });
  }
}

/** Saves and lets go of a document nothing shows any more. */
export async function closeReaderDoc(docId: string): Promise<void> {
  if (store().playback.docId === docId) stopReader();
  await saveNow(docId);
  if (voiceContext?.docId === docId) {
    voiceContext = null;
    releaseUrls();
  }
  store().dropDoc(docId);
}

/**
 * Deletes documents from the library, with their audio. A document playing
 * stops first, and nothing is saved afterwards: a save would bring its folder
 * back.
 */
export async function deleteReaderDocs(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    if (store().playback.docId === id) {
      cancelPending();
      stopTracking();
      detachAudio();
      clip = null;
      store().setPlayback({
        ...IDLE_PLAYBACK,
        exporting: store().playback.exporting,
      });
    }
    const timer = saveTimers.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.delete(id);
    unsavedDurations.delete(id);
    if (voiceContext?.docId === id) {
      voiceContext = null;
      releaseUrls();
    }
    store().dropDoc(id);
  }
  for (const id of ids) await readerNative.remove(id);
}

export type ReaderSummary = {
  docId: string;
  title: string;
  phase: PlaybackPhase;
  wordIndex: number;
  word: string | null;
  segment: number;
  segments: number;
  words: number;
  positionMs: number;
  totalMs: number;
  speed: number;
  voiceId: string | null;
  stopAtBookmarks: boolean;
  cutPoints: {
    id: string;
    kind: CutKind;
    wordIndex: number;
    label: string;
    pauseMs: number;
    source: string;
  }[];
  error: string | null;
  /** The latest export: running with progress, done with its files, or failed. */
  export: ExportOutcome | null;
  /** The OS media controls (Now Playing, media keys) can drive the Reader. */
  osMediaControls: boolean;
};

/** What an agent sees of a document: position, cuts and timing, no audio. */
export function summarize(docId: string): ReaderSummary | null {
  const entry = entryOf(docId);
  if (!entry) return null;
  const { playback } = store();
  const live = playback.docId === docId;
  const wordIndex = live ? playback.wordIndex : entry.state.lastWordIndex;
  return {
    docId,
    title: entry.state.title,
    phase: live
      ? playback.phase
      : entry.state.status === "finished"
        ? "finished"
        : "idle",
    wordIndex,
    word: entry.doc.words[wordIndex]?.text ?? null,
    segment: entry.doc.words[wordIndex]?.segment ?? 0,
    segments: entry.doc.segments.length,
    words: entry.doc.words.length,
    positionMs: Math.round(
      live
        ? playback.positionMs
        : (entry.timeline.starts[entry.doc.words[wordIndex]?.segment ?? 0] ??
            0),
    ),
    totalMs: Math.round(entry.timeline.totalMs),
    speed: entry.state.speed,
    voiceId: entry.state.voiceId,
    stopAtBookmarks: entry.state.stopAtBookmarks,
    cutPoints: allCuts(entry.doc, entry.state.cutPoints).map((c) => ({
      id: c.id,
      kind: c.kind,
      wordIndex: c.wordIndex,
      label: c.label,
      pauseMs: c.pauseMs,
      source: c.source,
    })),
    error: live ? playback.error : null,
    export: store().exports[docId] ?? null,
    osMediaControls:
      typeof navigator !== "undefined" && "mediaSession" in navigator,
  };
}
