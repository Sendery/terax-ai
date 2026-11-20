import { describe, expect, it } from "vitest";
import type { VoiceOption } from "@/modules/tts";
import type { TtsStatus } from "@/modules/tts/lib/native";
import { languageProviders } from "./LanguagesCard";
import { pickRecordingMime } from "./RecordSample";
import { filterVoices } from "./VoicesGallery";

describe("gallery filter", () => {
  it("splits ready voices from the ones that need an install", () => {
    const options = [{ ready: true }, { ready: false }, { ready: true }] as VoiceOption[];
    expect(filterVoices(options, "all")).toHaveLength(3);
    expect(filterVoices(options, "ready")).toHaveLength(2);
    expect(filterVoices(options, "pending")).toHaveLength(1);
  });
});

describe("languageProviders", () => {
  it("counts the providers that speak a language and how many are installed", () => {
    const status = {
      engines: [
        { id: "pocket", installed: true },
        { id: "kokoro", installed: true },
      ],
    } as unknown as TtsStatus;
    // Kokoro has no German; Pocket, OmniVoice, ZONOS3 and Chatterbox do.
    expect(languageProviders("de-DE", status)).toEqual({
      engines: ["chatterbox", "pocket", "omnivoice", "zonos3"],
      installed: 1,
    });
    expect(languageProviders("fr-FR", status).installed).toBe(2);
  });
});

describe("pickRecordingMime", () => {
  it("prefers Opus in WebM, then WebM, then MP4", () => {
    expect(pickRecordingMime(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickRecordingMime((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecordingMime(() => false)).toBeUndefined();
  });
});
