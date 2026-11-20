import { beforeEach, describe, expect, it, vi } from "vitest";

const tts = vi.hoisted(() => ({ speaking: false, stopSpeaking: vi.fn() }));
vi.mock("@/modules/tts", () => ({
  stopSpeaking: tts.stopSpeaking,
  useTtsStore: Object.assign(
    (select: (s: { speaking: boolean }) => unknown) =>
      select({ speaking: tts.speaking }),
    { getState: () => ({ speaking: tts.speaking }) },
  ),
}));
vi.mock("./player", () => ({ stopReader: vi.fn() }));

import { useReaderStore } from "@/modules/reader/store/readerStore";
import { stopReader } from "./player";
import { isSoundingNow, stopEverything } from "./sounding";

beforeEach(() => {
  tts.speaking = false;
  tts.stopSpeaking.mockClear();
  vi.mocked(stopReader).mockClear();
  useReaderStore.getState().setPlayback({ docId: null, phase: "idle" });
});

describe("stopEverything", () => {
  it("stops one-shot speech", () => {
    tts.speaking = true;
    expect(isSoundingNow()).toBe(true);
    expect(stopEverything()).toBe(true);
    expect(tts.stopSpeaking).toHaveBeenCalled();
    expect(stopReader).not.toHaveBeenCalled();
  });

  it("stops the Reader too, which the old Stop reading did not", () => {
    useReaderStore
      .getState()
      .setPlayback({ docId: "0123456789ab", phase: "playing" });
    expect(isSoundingNow()).toBe(true);
    expect(stopEverything()).toBe(true);
    expect(stopReader).toHaveBeenCalledTimes(1);
  });

  it("leaves a paused reading alone and reports nothing was sounding", () => {
    useReaderStore
      .getState()
      .setPlayback({ docId: "0123456789ab", phase: "paused" });
    expect(isSoundingNow()).toBe(false);
    expect(stopEverything()).toBe(false);
    expect(stopReader).not.toHaveBeenCalled();
  });
});
