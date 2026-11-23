import { describe, expect, it, vi } from "vitest";
import { shouldYieldTerminalShortcut } from "@/modules/shortcuts/lib/terminalShortcutContext";

function descendant(...ancestors: string[]): EventTarget {
  return {
    closest: (selector: string) => {
      const candidates = selector.split(",").map((part) => part.trim());
      return ancestors.some((ancestor) => candidates.includes(ancestor))
        ? ({} as Element)
        : null;
    },
  } as unknown as EventTarget;
}

describe.each([
  [
    "native input",
    descendant("[data-native-terminal-grid]", "[data-native-terminal-leaf]"),
  ],
] as const)("%s shortcut ownership", (_name, target) => {
  it("leaves plain Mod+B for the terminal without reading selection", () => {
    const getSelection = vi.fn(() => "selected");
    expect(
      shouldYieldTerminalShortcut("sidebar.toggle", {
        target,
        shiftKey: false,
        getSelection,
      }),
    ).toBe(true);
    expect(getSelection).not.toHaveBeenCalled();
  });

  it("retains the explicit Mod+Shift+B explorer override", () => {
    expect(
      shouldYieldTerminalShortcut("sidebar.toggle", {
        target,
        shiftKey: true,
        getSelection: () => null,
      }),
    ).toBe(false);
  });

  it.each([null, "", " \t\n"])(
    "leaves selection-free Mod+J for the terminal (%j)",
    (selection) => {
      expect(
        shouldYieldTerminalShortcut("ai.askSelection", {
          target,
          shiftKey: false,
          getSelection: () => selection,
        }),
      ).toBe(true);
    },
  );

  it("claims Mod+J when the focused terminal has a selection", () => {
    expect(
      shouldYieldTerminalShortcut("ai.askSelection", {
        target,
        shiftKey: false,
        getSelection: () => " selected output ",
      }),
    ).toBe(false);
  });
});

describe.each([
  ["editor", descendant(".cm-editor")],
  [
    "native block draft",
    descendant(".cm-editor", "[data-native-terminal-leaf]"),
  ],
  ["native block action", descendant("[data-native-terminal-leaf]")],
  ["unfocused target", null],
  ["non-element event target", {} as EventTarget],
] as const)("%s shortcut ownership", (_name, target) => {
  it.each(["sidebar.toggle", "ai.askSelection"] as const)(
    "keeps the app's %s behavior",
    (id) => {
      const getSelection = vi.fn(() => null);
      expect(
        shouldYieldTerminalShortcut(id, {
          target,
          shiftKey: false,
          getSelection,
        }),
      ).toBe(false);
      expect(getSelection).not.toHaveBeenCalled();
    },
  );
});
