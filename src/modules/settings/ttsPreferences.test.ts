import { describe, expect, it } from "vitest";
import { isTtsDevice, isTtsLanguage } from "@/modules/tts/lib/engines";
import {
  coerceTtsDevices,
  coerceTtsIdleStopMinutes,
  coerceTtsLanguages,
  DEFAULT_PREFERENCES,
  ttsDeviceFor,
  TTS_IDLE_STOP_DEFAULT,
  TTS_IDLE_STOP_MAX,
  TTS_IDLE_STOP_MIN,
} from "./store";

describe("speech output preferences", () => {
  it("defaults to Spanish, automatic devices and a ten minute idle stop", () => {
    expect(DEFAULT_PREFERENCES.ttsDefaultLanguage).toBe("es-ES");
    expect(DEFAULT_PREFERENCES.ttsDevices).toEqual({});
    expect(DEFAULT_PREFERENCES.ttsLanguages).toEqual(["es-ES", "en-US"]);
    expect(ttsDeviceFor(DEFAULT_PREFERENCES.ttsDevices, "kokoro")).toBe("auto");
    expect(DEFAULT_PREFERENCES.ttsIdleStopMinutes).toBe(10);
    expect(TTS_IDLE_STOP_DEFAULT).toBe(10);
    expect(TTS_IDLE_STOP_MIN).toBe(0);
    expect(TTS_IDLE_STOP_MAX).toBe(240);
  });

  it("accepts only the six languages and the four devices", () => {
    expect(isTtsLanguage(DEFAULT_PREFERENCES.ttsDefaultLanguage)).toBe(true);
    expect(isTtsLanguage("pt-BR")).toBe(true);
    expect(isTtsLanguage("ja-JP")).toBe(false);
    expect(isTtsDevice("mps")).toBe(true);
    expect(isTtsLanguage(undefined)).toBe(false);
    expect(isTtsDevice("rocm")).toBe(false);
    expect(isTtsDevice(null)).toBe(false);
  });

  it("clamps and rounds the idle stop, falling back for junk", () => {
    expect(coerceTtsIdleStopMinutes(0)).toBe(0);
    expect(coerceTtsIdleStopMinutes(7)).toBe(7);
    expect(coerceTtsIdleStopMinutes(7.6)).toBe(8);
    expect(coerceTtsIdleStopMinutes(-3)).toBe(0);
    expect(coerceTtsIdleStopMinutes(9_000)).toBe(240);
    expect(coerceTtsIdleStopMinutes(Number.NaN)).toBe(10);
    expect(coerceTtsIdleStopMinutes(Number.POSITIVE_INFINITY)).toBe(10);
    expect(coerceTtsIdleStopMinutes("15")).toBe(10);
    expect(coerceTtsIdleStopMinutes(null)).toBe(10);
    expect(coerceTtsIdleStopMinutes(undefined)).toBe(10);
  });

  it("seeds every engine from the pre-dev.26 single device, once", () => {
    // Nothing stored yet: the old global device applies to every engine.
    expect(coerceTtsDevices(undefined, "cpu")).toEqual({
      kokoro: "cpu",
      chatterbox: "cpu",
      pocket: "cpu",
      omnivoice: "cpu",
      zonos3: "cpu",
    });
    expect(coerceTtsDevices(undefined, "auto")).toEqual({});
    expect(coerceTtsDevices(undefined, "metal")).toEqual({});
    // Once the map exists it wins, and junk entries are dropped.
    expect(
      coerceTtsDevices({ pocket: "cpu", kokoro: "auto", bogus: "cpu", zonos3: "rocm" }, "mps"),
    ).toEqual({ pocket: "cpu" });
  });

  it("keeps enabled languages valid, ordered, unique and with the default", () => {
    expect(coerceTtsLanguages(undefined, "es-ES")).toEqual(["es-ES", "en-US"]);
    expect(coerceTtsLanguages(["it-IT", "es-ES", "it-IT", "xx"], "de-DE")).toEqual([
      "es-ES",
      "de-DE",
      "it-IT",
    ]);
    expect(coerceTtsLanguages([], "fr-FR")).toEqual(["fr-FR"]);
    expect(coerceTtsLanguages("es-ES", "en-US")).toEqual(["es-ES", "en-US"]);
  });
});
