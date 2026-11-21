import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "@/modules/settings/store";
import { isSttProvider } from "@/modules/ai/config";
import {
  coerceSttDevice,
  coerceSttDictionary,
  coerceSttLanguage,
  coerceSttLocalModel,
  coerceSttMode,
  parseSttDictionaryImport,
  serializeSttDictionary,
  STT_DICTIONARY_MAX_ENTRIES,
} from "./settings";

describe("dictation preferences", () => {
  it("defaults to the Light model, automatic language, Prompt style and live segments", () => {
    expect(DEFAULT_PREFERENCES.sttLocalModel).toBe("rumble-2-flash");
    expect(DEFAULT_PREFERENCES.sttLanguage).toBe("auto");
    expect(DEFAULT_PREFERENCES.sttMode).toBe("prompt");
    expect(DEFAULT_PREFERENCES.sttDictionary).toEqual([]);
    expect(DEFAULT_PREFERENCES.sttLiveSegments).toBe(true);
    expect(DEFAULT_PREFERENCES.sttDevice).toBe("auto");
  });

  it("knows the local provider and rejects unknown ones", () => {
    expect(isSttProvider("local")).toBe(true);
    expect(isSttProvider("whispercpp")).toBe(true);
    expect(isSttProvider("deepgram")).toBe(false);
    expect(isSttProvider(undefined)).toBe(false);
  });

  it("falls back for junk values", () => {
    expect(coerceSttLanguage("es-ES")).toBe("es-ES");
    expect(coerceSttLanguage("ja-JP")).toBe("auto");
    expect(coerceSttMode("formal")).toBe("formal");
    expect(coerceSttMode("shouty")).toBe("prompt");
    expect(coerceSttLocalModel("whisper-large")).toBe("rumble-2-flash");
    expect(coerceSttDevice("cuda")).toBe("cuda");
    expect(coerceSttDevice("rocm")).toBe("auto");
  });

  it("trims, deduplicates and drops spoken forms equal to the term", () => {
    expect(
      coerceSttDictionary([
        { written: "  Pi-Terax ", spoken: "piterax" },
        { written: "Pi-Terax", spoken: "Piterax" },
        { written: "Kokoro", spoken: "kokoro" },
        { written: "" },
        { spoken: "orphan" },
        "nope",
        null,
        { written: "x".repeat(81) },
        { written: "Sendery", spoken: 3 },
      ]),
    ).toEqual([
      { written: "Pi-Terax", spoken: "piterax" },
      { written: "Kokoro" },
      { written: "Sendery" },
    ]);
    expect(coerceSttDictionary("Kokoro")).toEqual([]);
  });

  it("caps the dictionary", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ written: `term${i}` }));
    expect(coerceSttDictionary(many)).toHaveLength(STT_DICTIONARY_MAX_ENTRIES);
  });

  it("imports plain text, arrows for corrections and comments", () => {
    expect(
      parseSttDictionaryImport("# my terms\nKokoro\nsenderi => Sendery\n piterax -> Pi-Terax \n\n"),
    ).toEqual([
      { written: "Kokoro" },
      { written: "Sendery", spoken: "senderi" },
      { written: "Pi-Terax", spoken: "piterax" },
    ]);
  });

  it("round-trips its own JSON export, and reads a bare array", () => {
    const entries = [{ written: "Pi-Terax", spoken: "piterax" }, { written: "ZONOS" }];
    expect(parseSttDictionaryImport(serializeSttDictionary(entries))).toEqual(entries);
    expect(parseSttDictionaryImport(JSON.stringify(entries))).toEqual(entries);
    expect(parseSttDictionaryImport("")).toEqual([]);
  });
});
