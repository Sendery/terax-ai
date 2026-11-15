import xterm from "@xterm/xterm";
import { registerOsc52ClipboardHandler } from "@/modules/terminal/lib/osc-handlers";
import cases from "@/modules/terminal/gl/fixtures/clipboard-policy.json";
import { describe, expect, it } from "vitest";

describe("installed xterm clipboard framing reference", () => {
  it.each(cases)(
    "$name across every UTF8 boundary",
    async ({ input, expected }) => {
      const bytes = new TextEncoder().encode(input);
      for (let split = 0; split <= bytes.length; split++) {
        const terminal = new xterm.Terminal();
        const writes: string[] = [];
        const release = registerOsc52ClipboardHandler(terminal, (text) => {
          writes.push(text);
        });
        try {
          await new Promise<void>((resolve) =>
            terminal.write(bytes.slice(0, split), resolve),
          );
          await new Promise<void>((resolve) =>
            terminal.write(bytes.slice(split), resolve),
          );
          await Promise.resolve();
          expect(writes, `split ${split}`).toEqual(
            expected === null ? [] : [expected],
          );
        } finally {
          release();
          terminal.dispose();
        }
      }
    },
  );
});
