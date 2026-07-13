import { describe, expect, it } from "vitest";
import {
  KeyboardProtocolTracker,
  shiftEnterSequence,
} from "./keyboardProtocol";

const enc = (s: string) => new TextEncoder().encode(s);

describe("shiftEnterSequence", () => {
  it("emits the legacy ESC+CR when modifyOtherKeys is off", () => {
    expect(shiftEnterSequence(0)).toBe("\x1b\r");
  });

  it("emits the xterm modifyOtherKeys encoding when active", () => {
    // CSI 27 ; modifier(shift=2) ; codepoint(enter=13) ~
    expect(shiftEnterSequence(1)).toBe("\x1b[27;2;13~");
    expect(shiftEnterSequence(2)).toBe("\x1b[27;2;13~");
  });
});

describe("KeyboardProtocolTracker", () => {
  it("defaults to modifyOtherKeys off", () => {
    expect(new KeyboardProtocolTracker().modifyOtherKeys).toBe(0);
  });

  it("enables modifyOtherKeys on XTMODKEYS set (level 2)", () => {
    const t = new KeyboardProtocolTracker();
    t.ingest(enc("\x1b[>4;2m"));
    expect(t.modifyOtherKeys).toBe(2);
  });

  it("enables level 1", () => {
    const t = new KeyboardProtocolTracker();
    t.ingest(enc("\x1b[>4;1m"));
    expect(t.modifyOtherKeys).toBe(1);
  });

  it("disables on XTMODKEYS reset (level 0)", () => {
    const t = new KeyboardProtocolTracker();
    t.ingest(enc("\x1b[>4;2m"));
    t.ingest(enc("\x1b[>4;0m"));
    expect(t.modifyOtherKeys).toBe(0);
  });

  it("resets to off when value is omitted (CSI > 4 m)", () => {
    const t = new KeyboardProtocolTracker();
    t.ingest(enc("\x1b[>4;2m"));
    t.ingest(enc("\x1b[>4m"));
    expect(t.modifyOtherKeys).toBe(0);
  });

  it("ignores other XTMODKEYS resources", () => {
    const t = new KeyboardProtocolTracker();
    t.ingest(enc("\x1b[>0;1m"));
    t.ingest(enc("\x1b[>2;3m"));
    expect(t.modifyOtherKeys).toBe(0);
  });

  it("ignores SGR color sequences", () => {
    const t = new KeyboardProtocolTracker();
    t.ingest(enc("\x1b[31mhello\x1b[0m\x1b[1;32mworld\x1b[m"));
    expect(t.modifyOtherKeys).toBe(0);
  });

  it("does not trip on the Kitty keyboard protocol query", () => {
    const t = new KeyboardProtocolTracker();
    // pi-tui's probe: push kitty flags, query flags, device attributes.
    t.ingest(enc("\x1b[>7u\x1b[?u\x1b[c"));
    expect(t.modifyOtherKeys).toBe(0);
  });

  it("detects the enable even when embedded in surrounding output", () => {
    const t = new KeyboardProtocolTracker();
    t.ingest(enc("prompt$ \x1b[>4;2mrest of line\n"));
    expect(t.modifyOtherKeys).toBe(2);
  });

  it("handles a sequence split across ingest calls", () => {
    const t = new KeyboardProtocolTracker();
    t.ingest(enc("\x1b[>4;"));
    expect(t.modifyOtherKeys).toBe(0);
    t.ingest(enc("2m"));
    expect(t.modifyOtherKeys).toBe(2);
  });

  it("handles a split at the ESC boundary", () => {
    const t = new KeyboardProtocolTracker();
    t.ingest(enc("\x1b"));
    t.ingest(enc("[>4;2m"));
    expect(t.modifyOtherKeys).toBe(2);
  });

  it("recovers after a bailed partial (no false carry growth)", () => {
    const t = new KeyboardProtocolTracker();
    // Looks like a prefix then diverges to a non-matching final byte.
    t.ingest(enc("\x1b[>4;2X"));
    expect(t.modifyOtherKeys).toBe(0);
    t.ingest(enc("\x1b[>4;2m"));
    expect(t.modifyOtherKeys).toBe(2);
  });

  it("reflects the full pi-tui negotiation stream", () => {
    const t = new KeyboardProtocolTracker();
    // kitty query goes unanswered by xterm, pi falls back and enables modifyOtherKeys
    t.ingest(enc("\x1b[>7u\x1b[?u\x1b[c"));
    t.ingest(enc("\x1b[>4;2m"));
    expect(t.modifyOtherKeys).toBe(2);
    expect(shiftEnterSequence(t.modifyOtherKeys)).toBe("\x1b[27;2;13~");
  });
});
