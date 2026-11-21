import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { transcribeAudio, type SttOptions } from "../lib/stt";
import type { SttProvider } from "../config";
import { STT_MODEL_ENGINE } from "@/modules/stt/lib/catalog";
import { NOT_INSTALLED_MESSAGE } from "@/modules/stt/lib/client";
import { sttNative, transcriberStatusOf } from "@/modules/stt/lib/native";
import { DictationRecorder } from "@/modules/stt/lib/recorder";
import {
  startLocalDictation,
  type LocalDictation,
} from "@/modules/stt/lib/session";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

function providerNeedsKey(provider: SttProvider): boolean {
  return provider === "openai" || provider === "groq";
}

function getApiKeyForStt(
  apiKeys: import("../lib/keyring").ProviderKeys,
  provider: SttProvider,
): string | null {
  if (provider === "openai") return apiKeys.openai;
  if (provider === "groq") return apiKeys.groq;
  return null;
}

type State = "idle" | "recording" | "transcribing";

/**
 * Whether the local dictation engine is installed, read when the local
 * provider is chosen and again before each dictation. `null` while unknown.
 */
function useLocalInstalled(
  active: boolean,
): [boolean | null, () => Promise<boolean>] {
  const model = usePreferencesStore((s) => s.sttLocalModel);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const check = useCallback(async () => {
    try {
      const status = await sttNative.status();
      const ok =
        transcriberStatusOf(status, STT_MODEL_ENGINE[model])?.installed ?? false;
      setInstalled(ok);
      return ok;
    } catch {
      setInstalled(false);
      return false;
    }
  }, [model]);
  useEffect(() => {
    if (active) void check();
  }, [active, check]);
  return [installed, check];
}

export function useWhisperRecording({
  onResult,
}: {
  onResult: (text: string) => void;
}) {
  const apiKeys = useChatStore((s) => s.apiKeys);
  const sttProvider = usePreferencesStore((s) => s.sttProvider);
  const groqSttModel = usePreferencesStore((s) => s.groqSttModel);
  const whispercppBaseURL = usePreferencesStore((s) => s.whispercppBaseURL);
  const [state, setState] = useState<State>("idle");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const localRef = useRef<LocalDictation | null>(null);
  // Stop pressed while the microphone was still opening.
  const startingRef = useRef(false);
  const stopRequestedRef = useRef(false);

  const isLocal = sttProvider === "local";
  const [localInstalled, checkLocal] = useLocalInstalled(isLocal);

  const needsKey = providerNeedsKey(sttProvider);
  const providerKey = needsKey ? getApiKeyForStt(apiKeys, sttProvider) : null;
  const hasKey = needsKey ? !!providerKey : true;
  // The local engine needs no key; when it is missing, the button stays
  // clickable and explains itself with a toast.
  const unavailableReason =
    isLocal && localInstalled === false ? NOT_INSTALLED_MESSAGE : null;

  const supported = isLocal
    ? DictationRecorder.supported()
    : typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined";

  const sttOptions: SttOptions = {
    groqSttModel,
    whispercppBaseURL,
  };

  const teardownStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stopLocal = useCallback(async () => {
    const session = localRef.current;
    if (!session) return;
    localRef.current = null;
    setState("transcribing");
    try {
      const text = await session.stop();
      if (text.trim()) onResult(text.trim());
    } catch (e) {
      console.error("stt.local", e);
      toast.error(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setState("idle");
    }
  }, [onResult]);

  const stop = useCallback(() => {
    if (startingRef.current) {
      stopRequestedRef.current = true;
      return;
    }
    if (localRef.current) {
      void stopLocal();
      return;
    }
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, [stopLocal]);

  const startLocal = useCallback(async () => {
    if (!(await checkLocal())) {
      toast.error(NOT_INSTALLED_MESSAGE);
      return;
    }
    const prefs = usePreferencesStore.getState();
    setState("recording");
    startingRef.current = true;
    stopRequestedRef.current = false;
    try {
      localRef.current = await startLocalDictation({
        model: prefs.sttLocalModel,
        device: prefs.sttDevice,
        language: prefs.sttLanguage,
        mode: prefs.sttMode,
        dictionary: prefs.sttDictionary,
        live: prefs.sttLiveSegments,
      });
      startingRef.current = false;
      if (stopRequestedRef.current) void stopLocal();
    } catch (e) {
      startingRef.current = false;
      console.error("stt.local.start", e);
      localRef.current = null;
      setState("idle");
      toast.error(
        e instanceof DOMException
          ? "Microphone access failed"
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }, [checkLocal, stopLocal]);

  const start = useCallback(async () => {
    if (!supported || !hasKey || state !== "idle") return;
    if (isLocal) {
      await startLocal();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        teardownStream();
        if (blob.size === 0) {
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const text = await transcribeAudio(blob, sttProvider, apiKeys, sttOptions);
          if (text.trim()) onResult(text.trim());
        } catch (e) {
          console.error("stt.transcribe", e);
          toast.error(e instanceof Error ? e.message : "Transcription failed");
        } finally {
          setState("idle");
        }
      };
      recRef.current = rec;
      rec.start();
      setState("recording");
    } catch (e) {
      console.error("stt.getUserMedia", e);
      toast.error("Microphone access failed");
      teardownStream();
      setState("idle");
    }
  }, [
    apiKeys,
    sttProvider,
    sttOptions,
    onResult,
    state,
    supported,
    hasKey,
    isLocal,
    startLocal,
  ]);

  useEffect(() => {
    return () => {
      recRef.current?.stop();
      localRef.current?.cancel();
      localRef.current = null;
      teardownStream();
    };
  }, []);

  return {
    state,
    recording: state === "recording",
    transcribing: state === "transcribing",
    start,
    stop,
    supported,
    hasKey,
    /** Set when the provider cannot record yet, for the button's tooltip. */
    unavailableReason,
    sttProvider,
  };
}
