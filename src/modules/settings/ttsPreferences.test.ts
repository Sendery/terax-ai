import { describe, expect, it } from "vitest";
import { isTtsDevice, isTtsLanguage } from "@/modules/tts/lib/engines";
import {
  coerceTtsIdleStopMinutes,
  DEFAULT_PREFERENCES,
  TTS_IDLE_STOP_DEFAULT,
  TTS_IDLE_STOP_MAX,
  TTS_IDLE_STOP_MIN,
} from "./store";

describe("speech output preferences", () => {
  it("defaults to Spanish, automatic device and a ten minute idle stop", () => {
    expect(DEFAULT_PREFERENCES.ttsDefaultLanguage).toBe("es-ES");
    expect(DEFAULT_PREFERENCES.ttsDevice).toBe("auto");
    expect(DEFAULT_PREFERENCES.ttsIdleStopMinutes).toBe(10);
    expect(TTS_IDLE_STOP_DEFAULT).toBe(10);
    expect(TTS_IDLE_STOP_MIN).toBe(0);
    expect(TTS_IDLE_STOP_MAX).toBe(240);
  });

  it("accepts only the two languages and the four devices", () => {
    expect(isTtsLanguage(DEFAULT_PREFERENCES.ttsDefaultLanguage)).toBe(true);
    expect(isTtsDevice(DEFAULT_PREFERENCES.ttsDevice)).toBe(true);
    expect(isTtsLanguage("pt-BR")).toBe(false);
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
});
