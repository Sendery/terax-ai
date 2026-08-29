import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./useExternalCommandBridge.ts", import.meta.url),
  "utf8",
);

describe("useExternalCommandBridge", () => {
  it("subscribes once for the lifetime of the window", () => {
    // Tauri's listen() registers asynchronously. Resubscribing when the
    // handler identity changes opens a window where an incoming request is
    // dropped and the Pi caller waits out its timeout, which is exactly what
    // happens on the request that follows any mutating command.
    const effect = source.slice(source.indexOf("useEffect("));
    const deps = effect.slice(effect.indexOf("}, ["));

    expect(deps.startsWith("}, [])")).toBe(true);
  });

  it("keeps the live registry reachable without resubscribing", () => {
    expect(source).toContain("createExternalCommandDispatcher");
    expect(source).toContain("setRegistry");
  });
});
