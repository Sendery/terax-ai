import { beforeEach, describe, expect, it, vi } from "vitest";
import { TtsClientError } from "@/modules/tts/lib/client";
import { DEFAULT_PREFERENCES } from "@/modules/settings/store";
import { cleanOrKeep, reportOnce, resetReported } from "./cleanup";

describe("cleanOrKeep", () => {
  it("leaves the audio alone when cleanup is off", async () => {
    const clean = vi.fn(async () => "cleaned");
    const onSkip = vi.fn();
    await expect(cleanOrKeep(false, "raw", clean, onSkip)).resolves.toBe("raw");
    expect(clean).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("returns the cleaned audio when cleanup runs", async () => {
    const onSkip = vi.fn();
    await expect(
      cleanOrKeep(true, "raw", async () => "cleaned", onSkip),
    ).resolves.toBe("cleaned");
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("keeps the recording and says why when cleanup cannot run", async () => {
    const onSkip = vi.fn();
    const result = await cleanOrKeep(
      true,
      "raw",
      async () => {
        throw new Error("not installed");
      },
      onSkip,
    );
    expect(result).toBe("raw");
    expect(onSkip).toHaveBeenCalledWith("not installed");
  });

  it("never swallows a cancellation", async () => {
    const onSkip = vi.fn();
    await expect(
      cleanOrKeep(
        true,
        "raw",
        async () => {
          throw new TtsClientError("aborted", "stopped");
        },
        onSkip,
      ),
    ).rejects.toThrow("stopped");
    const controller = new AbortController();
    controller.abort();
    await expect(
      cleanOrKeep(
        true,
        "raw",
        async () => {
          throw new Error("network");
        },
        onSkip,
        controller.signal,
      ),
    ).rejects.toThrow("network");
    expect(onSkip).not.toHaveBeenCalled();
  });
});

describe("reportOnce", () => {
  beforeEach(() => resetReported());

  it("shows each reason once per session", () => {
    const show = vi.fn();
    reportOnce("a", show);
    reportOnce("a", show);
    reportOnce("b", show);
    expect(show.mock.calls).toEqual([["a"], ["b"]]);
  });
});

describe("cleanup preferences", () => {
  it("are all off until the person switches them on", () => {
    expect(DEFAULT_PREFERENCES.cleanDictationAudio).toBe(false);
    expect(DEFAULT_PREFERENCES.cleanReadingAudio).toBe(false);
    expect(DEFAULT_PREFERENCES.cleanVoiceSamples).toBe(false);
    expect(DEFAULT_PREFERENCES.isolatorDevice).toBe("auto");
  });
});
