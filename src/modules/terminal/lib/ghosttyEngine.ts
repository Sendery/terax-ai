import type { EngineSession } from "@/modules/terminal/gl/engineSession";
import type { TerminalEngine } from "@/modules/terminal/lib/terminalEngine";

export function adaptGhosttyEngine(session: EngineSession): TerminalEngine {
  return {
    get id() {
      return session.id;
    },
    write: (text) => session.write(text),
    resize: (cols, rows) => session.resizeAndWait(cols, rows),
    close: () => session.close(),
  };
}
