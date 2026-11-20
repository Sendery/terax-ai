import { Button } from "@/components/ui/button";
import {
  RECORDING_SENTENCES,
  type TtsLanguage,
} from "@/modules/tts/lib/engines";
import { Mic01Icon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

export const RECORD_SECONDS = 10;

/** A MIME type the webview can record, or undefined for its default. */
export function pickRecordingMime(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
): string | undefined {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (isSupported(type)) return type;
  }
  return undefined;
}

export function recordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

type Props = {
  language: TtsLanguage;
  disabled?: boolean;
  /** Receives the recording; the caller converts and imports it. */
  onRecorded: (blob: Blob) => void;
  onError: (message: string) => void;
};

/**
 * Records up to ten seconds from the microphone, the way dictation does, with
 * a sentence to read in the voice's language. Stops early on a second click.
 */
export function RecordSample({ language, disabled, onRecorded, onError }: Props) {
  const [left, setLeft] = useState<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);

  const teardown = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    recorder.current = null;
    setLeft(null);
  };

  // Leaving the editor mid-recording releases the microphone.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      for (const track of stream.current?.getTracks() ?? []) track.stop();
    },
    [],
  );

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  const start = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mimeType = pickRecordingMime();
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        teardown();
        if (blob.size > 0) onRecorded(blob);
        else onError("Nothing was recorded. Check the microphone and try again.");
      };
      recorder.current = rec;
      rec.start();
      setLeft(RECORD_SECONDS);
      timer.current = window.setInterval(() => {
        setLeft((value) => {
          const next = (value ?? RECORD_SECONDS) - 1;
          if (next <= 0) stop();
          return Math.max(0, next);
        });
      }, 1000);
    } catch (err) {
      teardown();
      onError(
        `Microphone access failed: ${err instanceof Error ? err.message : String(err)}. Allow Terax in System Settings, Privacy, Microphone.`,
      );
    }
  };

  if (!recordingSupported()) return null;
  const recording = left !== null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={recording ? "destructive" : "outline"}
          className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
          disabled={disabled && !recording}
          onClick={() => (recording ? stop() : void start())}
        >
          <HugeiconsIcon
            icon={recording ? StopIcon : Mic01Icon}
            size={12}
            strokeWidth={1.75}
          />
          {recording ? `Stop (${left} s)` : `Record ${RECORD_SECONDS} s`}
        </Button>
        {recording ? (
          <span className="text-[10.5px] text-muted-foreground">
            Recording. Read the sentence below at your normal pace.
          </span>
        ) : null}
      </div>
      <p className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed">
        {RECORDING_SENTENCES[language]}
      </p>
    </div>
  );
}
