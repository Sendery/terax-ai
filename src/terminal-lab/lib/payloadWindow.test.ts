import { describe, expect, it } from "vitest";
import { PAYLOAD_START, PayloadWindow } from "@/terminal-lab/lib/payloadWindow";

describe("PTY fixture boundaries", () => {
  it("excludes shell echo at every marker split and truncates only non-payload suffixes", () => {
    const encoder = new TextEncoder();
    for (let split = 0; split <= PAYLOAD_START.length; split++) {
      const stream = new PayloadWindow(6);
      const chunks = [
        `shell prompt${PAYLOAD_START.slice(0, split)}`,
        `${PAYLOAD_START.slice(split)}abc`,
        "defexit",
      ];
      expect(
        chunks
          .map((c) => new TextDecoder().decode(stream.push(encoder.encode(c))))
          .join(""),
      ).toBe("abcdef");
      expect(stream.received).toBe(6);
    }
  });
  it("does not parse or change payload escape sequences or UTF-8", () => {
    const bytes = new TextEncoder().encode("\x1b[31m\u4e2d\u6587\r\n");
    const stream = new PayloadWindow(bytes.length);
    stream.push(new TextEncoder().encode(PAYLOAD_START));
    expect(stream.push(bytes)).toEqual(bytes);
  });
});
