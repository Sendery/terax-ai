import { describe, expect, it } from "vitest";
import {
  idleCommand,
  SCRIPTED_SESSION,
  shellQuote,
  requireIdleScrollback,
} from "@/terminal-lab/lib/autorun";

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
  it("runs the requested shell comparison before the completion marker", () => {
    expect(SCRIPTED_SESSION).toContain("ls -la");
    expect(SCRIPTED_SESSION).toContain("\u4e2d\u6587");
    expect(SCRIPTED_SESSION).toContain("\u{1f680}");
    expect(SCRIPTED_SESSION).toContain("\\033[31m");
    expect(SCRIPTED_SESSION.endsWith("TERAX_LAB_READY';\r")).toBe(true);
  });
});
