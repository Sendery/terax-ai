import { describe, expect, it } from "vitest";
import { PILL_HISTORY_FOOTER } from "@/modules/tts/components/SpeakingPill";
import { LIBRARY_FOOTER } from "./ReaderLibrary";
import { READ_LABELS } from "./ReadMenuItems";

describe("the two histories point at each other", () => {
  it("sends the Readings library to the status-bar history", () => {
    expect(LIBRARY_FOOTER).toMatch(/status bar/);
  });

  it("sends the status-bar history to the Reader library", () => {
    expect(PILL_HISTORY_FOOTER).toMatch(/Reader library/);
    expect(PILL_HISTORY_FOOTER).toMatch(/Ctrl\+Alt\+B|⌥⌘B/);
  });
});

describe("READ_LABELS", () => {
  it("names each reading action once", () => {
    expect(READ_LABELS).toMatchObject({
      speak: "Speak",
      readHere: "Read here",
      readInNewTab: "Read in new tab",
      moveToTab: "Move to a tab",
      stop: "Stop",
      resume: "Resume",
    });
  });
});
