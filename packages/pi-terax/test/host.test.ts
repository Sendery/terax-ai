import { describe, expect, it } from "vitest";
import { detectTeraxHost, teraxEnableInstructions } from "../src/host.js";

describe("detectTeraxHost", () => {
  it("recognizes a Terax terminal via TERAX_TERMINAL", () => {
    const host = detectTeraxHost({ TERAX_TERMINAL: "1" });
    expect(host.inTerax).toBe(true);
    expect(host.available).toBe(true);
    expect(host.forced).toBe(false);
  });

  it("recognizes a Terax terminal via TERM_PROGRAM", () => {
    const host = detectTeraxHost({
      TERM_PROGRAM: "Terax",
      TERM_PROGRAM_VERSION: "0.9.0",
    });
    expect(host.inTerax).toBe(true);
    expect(host.termProgram).toBe("Terax");
    expect(host.termProgramVersion).toBe("0.9.0");
  });

  it("treats any other terminal as not-in-Terax and unavailable", () => {
    const host = detectTeraxHost({ TERM_PROGRAM: "Apple_Terminal" });
    expect(host.inTerax).toBe(false);
    expect(host.available).toBe(false);
  });

  it("empty environment is not a Terax host", () => {
    const host = detectTeraxHost({});
    expect(host.inTerax).toBe(false);
    expect(host.available).toBe(false);
  });

  it("TERAX_FORCE makes control available from a non-Terax shell", () => {
    const host = detectTeraxHost({
      TERM_PROGRAM: "iTerm.app",
      TERAX_FORCE: "1",
    });
    expect(host.inTerax).toBe(false);
    expect(host.forced).toBe(true);
    expect(host.available).toBe(true);
    expect(host.surface).toBe("external");
  });

  it("reports the surface Pi runs on", () => {
    expect(detectTeraxHost({ TERAX_TERMINAL: "1" }).surface).toBe("terminal");
    expect(detectTeraxHost({}).surface).toBe("external");
    const chat = detectTeraxHost({ TERAX_FORCE: "1", TERAX_SURFACE: "chat" });
    expect(chat.surface).toBe("chat");
    expect(chat.available).toBe(true);
    expect(chat.inTerax).toBe(false);
  });

  it("does not open the tools on TERAX_SURFACE alone", () => {
    const host = detectTeraxHost({ TERAX_SURFACE: "chat" });
    expect(host.available).toBe(false);
  });
});

describe("teraxEnableInstructions", () => {
  it("gives a macOS launch command", () => {
    expect(teraxEnableInstructions("darwin").command).toBe("open -a Terax");
  });

  it("gives platform-specific commands with actionable steps", () => {
    expect(teraxEnableInstructions("win32").command).toContain("Terax");
    expect(teraxEnableInstructions("linux").command).toBe("terax");
    expect(teraxEnableInstructions("linux").steps.length).toBeGreaterThan(0);
  });
});
