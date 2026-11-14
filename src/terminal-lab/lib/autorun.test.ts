import { afterEach, describe, expect, it, vi } from "vitest";
import {
  idleCommand,
  SCRIPTED_SESSION,
  scriptedSession,
  type LabTarget,
  shellQuote,
  requireIdleScrollback,
} from "@/terminal-lab/lib/autorun";

afterEach(() => vi.useRealTimers());

describe("lab shell scripts", () => {
  it("accepts only the measured requested history in every session", () => {
    expect(() => requireIdleScrollback([10_000, 10_000], 2)).not.toThrow();
    expect(() => requireIdleScrollback([10_000, 100], 2)).toThrow(
      "observed [10000, 100]",
    );
    expect(() => requireIdleScrollback([10_000], 2)).toThrow();
    expect(() => requireIdleScrollback([10_001, 10_000], 2)).toThrow();
    expect(() => requireIdleScrollback([null, 10_000], 2)).toThrow(
      "unavailable",
    );
  });
  it("quotes paths without allowing shell interpolation", () => {
    expect(shellQuote("/tmp/a'b $(touch nope)\nfile")).toBe(
      "'/tmp/a'\\''b $(touch nope)\nfile'",
    );
  });
  it("fills scrollback plus the viewport before announcing readiness", () => {
    expect(idleCommand(30)).toContain('"$i" -lt 10029');
    expect(idleCommand(30)).toContain("\\033[3J\\033[2J\\033[H");
    expect(idleCommand(30)).toContain("\\033[2J\\033[HTERAX_IDLE_READY");
  });
  it("reserves the marker row and restores the end cursor before shell prompt cleanup", () => {
    // Prompt erase-below must begin after the fixture, never beside the marker.
    expect(SCRIPTED_SESSION.startsWith("printf '\\033[2J\\033[2;1H';")).toBe(
      true,
    );
    const finalPaint = "printf '\\0337\\033[1;1HTERAX_LAB_READY\\0338';\r";
    expect(SCRIPTED_SESSION.endsWith(finalPaint)).toBe(true);
    expect(SCRIPTED_SESSION.indexOf(finalPaint)).toBeGreaterThan(
      SCRIPTED_SESSION.indexOf("underline"),
    );
    expect(SCRIPTED_SESSION.match(/TERAX_LAB_READY/g)).toHaveLength(1);
  });
  it("runs the requested shell comparison before the completion marker", () => {
    expect(SCRIPTED_SESSION).toContain("ls -la");
    expect(SCRIPTED_SESSION).toContain("\u4e2d\u6587");
    expect(SCRIPTED_SESSION).toContain("\u{1f680}");
    expect(SCRIPTED_SESSION).toContain("\\033[31m");
    expect(SCRIPTED_SESSION.endsWith("TERAX_LAB_READY\\0338';\r")).toBe(true);
  });
});

describe("scripted capture readiness", () => {
  it("waits for the final marker draw and then the existing shell settle interval", async () => {
    vi.useFakeTimers();
    let markDrawn = (_at: number | null) => {};
    const ready = new Promise<number | null>((resolve) => {
      markDrawn = resolve;
    });
    const target: LabTarget = {
      cursor: () => null,
      write: vi.fn(async () => {}),
      waitForCell: vi.fn(() => ready),
      capture: vi.fn(async () => "png"),
    };
    const capture = scriptedSession(target);
    expect(target.waitForCell).toHaveBeenCalledWith(0, 0, 84, 15_000);
    expect(target.write).toHaveBeenCalledWith(SCRIPTED_SESSION);
    await vi.advanceTimersByTimeAsync(1000);
    expect(target.capture).not.toHaveBeenCalled();
    markDrawn(1000);
    await vi.advanceTimersByTimeAsync(299);
    expect(target.capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(capture).resolves.toBe("png");
  });

  it("does not capture a fixture whose final marker never drew", async () => {
    const target: LabTarget = {
      cursor: () => null,
      write: vi.fn(async () => {}),
      waitForCell: vi.fn(async () => null),
      capture: vi.fn(async () => "png"),
    };
    await expect(scriptedSession(target)).rejects.toThrow(
      "scripted shell marker not drawn",
    );
    expect(target.capture).not.toHaveBeenCalled();
  });
});
