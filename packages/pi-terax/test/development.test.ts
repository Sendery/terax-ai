import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_CAPABILITIES,
  getDevelopmentGuide,
} from "../src/development.js";

describe("Terax development guides", () => {
  it("covers every supported contribution type", () => {
    expect(DEVELOPMENT_CAPABILITIES).toEqual([
      "feature",
      "window",
      "setting",
      "shortcut",
      "command",
    ]);
  });

  it("maps native windows to the Tauri and frontend entry points", () => {
    const guide = getDevelopmentGuide("window");

    expect(guide.inspect).toContain("src-tauri/src/lib.rs");
    expect(guide.inspect).toContain("src/settings/SettingsApp.tsx");
    expect(guide.invariants).toContain(
      "Reuse and focus an existing labeled window before creating another one.",
    );
    expect(guide.verify).toContain("pnpm check-types");
  });

  it("maps settings, shortcuts, and commands to their single sources of truth", () => {
    expect(getDevelopmentGuide("setting").inspect).toContain(
      "src/modules/settings/store.ts",
    );
    expect(getDevelopmentGuide("shortcut").inspect).toContain(
      "src/modules/shortcuts/shortcuts.ts",
    );
    expect(getDevelopmentGuide("command").inspect).toContain(
      "src/modules/commands/lib/registry.ts",
    );
  });

  it("returns isolated guide copies", () => {
    const first = getDevelopmentGuide("feature");
    first.inspect.push("mutated");

    expect(getDevelopmentGuide("feature").inspect).not.toContain("mutated");
  });
});
